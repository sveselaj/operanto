import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Growth G1 foundation against real PostgreSQL: tenant isolation,
 * permission enforcement, constraint-backed dedupe, audited lifecycle
 * transitions, suppression-overrides-everything, contact erasure and
 * prospect retention.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({
    organisationId: c.organisation.id,
  }),
}));

const {
  createGrowthAccount,
  transitionGrowthAccount,
  suppressGrowthAccount,
  eraseGrowthContact,
  isEmailSuppressed,
  listGrowthAccounts,
} = await import("@/lib/services/growth/accounts");
const { redactExpiredGrowthContacts } = await import("@/lib/services/privacy");
const { createTargetProfile, updateTargetProfile, setTargetProfileStatus } =
  await import("@/lib/services/growth/profiles");
const { previewImport, commitImport } = await import(
  "@/lib/services/growth/imports"
);
const { updateGrowthAccount, assignGrowthAccount } = await import(
  "@/lib/services/growth/accounts"
);

async function activeProfileId(ctx: Awaited<ReturnType<typeof makeCtx>>) {
  const profile = await db.targetProfile.create({
    data: {
      organisationId: ctx.organisation.id,
      name: `Profile ${Math.random().toString(36).slice(2)}`,
      status: "ACTIVE",
    },
  });
  return profile.id;
}

async function makeCtx(slug: string, role: "ADMIN" | "SUPERVISOR" | "OPERATOR" = "ADMIN") {
  const organisation =
    (await db.organisation.findUnique({ where: { slug } })) ??
    (await db.organisation.create({ data: { name: slug, slug } }));
  const user = await db.user.create({
    data: {
      email: `${slug}-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `${role} of ${slug}`,
      status: "ACTIVE",
    },
  });
  const membership = await db.membership.create({
    data: { organisationId: organisation.id, userId: user.id, role, status: "ACTIVE" },
  });
  return {
    organisation,
    membership,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

function accountInput(name: string, domain: string | null) {
  return {
    name,
    domain,
    country: "DE",
    source: { provider: "test", providerRecordId: `rec-${name}` },
  };
}

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Organisation", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describeDb("growth accounts foundation", () => {
  it("creates accounts with provenance and audits ids-only", async () => {
    const ctx = await makeCtx("org-a");
    const result = await createGrowthAccount(
      ctx,
      accountInput("Fenster Test GmbH", "https://www.fenster-test.example/x"),
    );
    expect(result.created).toBe(true);
    const account = await db.growthAccount.findFirstOrThrow({
      include: { sources: true },
    });
    expect(account.domainNormalized).toBe("fenster-test.example");
    expect(account.nameNormalized).toBe("fenster test");
    expect(account.status).toBe("IMPORTED");
    expect(account.sources).toHaveLength(1);
    const audits = await db.auditEvent.findMany({
      where: { eventType: "growth.account_created" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("Fenster Test GmbH");
  });

  it("duplicate domains are constraint-detected, recorded and never merged", async () => {
    const ctx = await makeCtx("org-a");
    const first = await createGrowthAccount(ctx, accountInput("Original GmbH", "dupe.example"));
    const second = await createGrowthAccount(
      ctx,
      { ...accountInput("Duplicate AG", "www.dupe.example"), source: { provider: "csv", providerRecordId: "row-2" } },
    );
    expect(second.created).toBe(false);
    if (!second.created) {
      expect(second.duplicateOfAccountId).toBe(
        (first as { accountId: string }).accountId,
      );
    }
    expect(await db.growthAccount.count()).toBe(1);
    const dupSource = await db.accountSourceRecord.findFirst({
      where: { provider: "csv" },
    });
    expect(dupSource?.duplicateOfAccountId).not.toBeNull();
    expect(
      await db.auditEvent.count({ where: { eventType: "growth.duplicate_detected" } }),
    ).toBe(1);

    // Same domain in ANOTHER organisation is not a duplicate — tenant scope.
    const foreign = await makeCtx("org-b");
    const foreignResult = await createGrowthAccount(
      foreign,
      accountInput("Other Org Same Domain", "dupe.example"),
    );
    expect(foreignResult.created).toBe(true);
  });

  it("tenant isolation: accounts are invisible and immovable across orgs", async () => {
    const orgA = await makeCtx("org-a");
    const orgB = await makeCtx("org-b");
    const created = await createGrowthAccount(orgA, accountInput("Iso GmbH", "iso.example"));
    const accountId = (created as { accountId: string }).accountId;
    expect(await listGrowthAccounts(orgB)).toHaveLength(0);
    await expect(
      transitionGrowthAccount(orgB, accountId, "NEEDS_REVIEW"),
    ).rejects.toThrow(/not found/);
  });

  it("permissions: operators cannot import, review or erase", async () => {
    const admin = await makeCtx("org-a");
    const operator = await makeCtx("org-a", "OPERATOR");
    await expect(
      createGrowthAccount(operator, accountInput("Nope GmbH", "nope.example")),
    ).rejects.toThrow(/Missing permission/);
    const created = await createGrowthAccount(admin, accountInput("Ok GmbH", "ok.example"));
    const accountId = (created as { accountId: string }).accountId;
    await expect(
      transitionGrowthAccount(operator, accountId, "NEEDS_REVIEW"),
    ).rejects.toThrow(/Missing permission/);
    const contact = await db.growthContact.create({
      data: {
        organisationId: admin.organisation.id,
        accountId,
        email: "person@ok.example",
        emailNormalized: "person@ok.example",
      },
    });
    await expect(eraseGrowthContact(operator, contact.id, "x")).rejects.toThrow(
      /Missing permission/,
    );
    // Operators can still see the accounts (growth:view).
    expect(await listGrowthAccounts(operator)).toHaveLength(1);
  });

  it("transitions are machine-enforced, audited, and G2 release-bounded", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, accountInput("Flow GmbH", "flow.example"));
    const accountId = (created as { accountId: string }).accountId;
    // Machine violations refuse.
    await expect(
      transitionGrowthAccount(ctx, accountId, "APPROVED"),
    ).rejects.toThrow(/Invalid account transition/);
    // Permitted G2 transitions work and audit.
    await transitionGrowthAccount(ctx, accountId, "NEEDS_REVIEW");
    await transitionGrowthAccount(ctx, accountId, "READY_FOR_RESEARCH");
    // The RELEASE BOUNDARY blocks machine-legal but unauthorized moves: a
    // crafted request cannot walk an account into research or approval.
    await expect(
      transitionGrowthAccount(ctx, accountId, "RESEARCHING"),
    ).rejects.toThrow(/outside the currently authorized Growth release/);
    // Even a row seeded mid-pipeline cannot advance through the service.
    await db.growthAccount.update({
      where: { id: accountId },
      data: { status: "READY_FOR_ASSESSMENT" },
    });
    await expect(
      transitionGrowthAccount(ctx, accountId, "APPROVED"),
    ).rejects.toThrow(/outside the currently authorized Growth release/);
    // Suppression is not an ordinary transition.
    await expect(
      transitionGrowthAccount(ctx, accountId, "SUPPRESSED"),
    ).rejects.toThrow(/dedicated suppression service/);
    expect(
      await db.auditEvent.count({ where: { eventType: "growth.account_status_changed" } }),
    ).toBe(2);
  });

  it("suppression is terminal, writes entries for domain + contacts, and overrides", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, accountInput("Stop GmbH", "stop.example"));
    const accountId = (created as { accountId: string }).accountId;
    await db.growthContact.create({
      data: {
        organisationId: ctx.organisation.id,
        accountId,
        firstName: "Max",
        email: "max@stop.example",
        emailNormalized: "max@stop.example",
      },
    });
    await suppressGrowthAccount(ctx, accountId, "requested no contact");
    const account = await db.growthAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.status).toBe("SUPPRESSED");
    expect(account.suppressedAt).not.toBeNull();
    expect(await isEmailSuppressed(ctx, "max@stop.example")).toBe(true);
    expect(await isEmailSuppressed(ctx, "OTHER@stop.example")).toBe(true); // domain entry
    expect(await isEmailSuppressed(ctx, "someone@else.example")).toBe(false);
    // Terminal: no ordinary transition leaves SUPPRESSED.
    await expect(
      transitionGrowthAccount(ctx, accountId, "NEEDS_REVIEW"),
    ).rejects.toThrow(/Invalid account transition/);
    // Suppression is tenant-scoped.
    const foreign = await makeCtx("org-b");
    expect(await isEmailSuppressed(foreign, "max@stop.example")).toBe(false);
  });

  it("contact erasure redacts PII, keeps the suppression objection, redacts drafts", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, accountInput("Erase GmbH", "erase.example"));
    const accountId = (created as { accountId: string }).accountId;
    const contact = await db.growthContact.create({
      data: {
        organisationId: ctx.organisation.id,
        accountId,
        firstName: "Erika",
        lastName: "Beispiel",
        email: "erika@erase.example",
        emailNormalized: "erika@erase.example",
        phone: "+49 000 000",
      },
    });
    const playbook = await db.outreachPlaybook.create({
      data: {
        organisationId: ctx.organisation.id,
        name: "PB",
        language: "de",
        valuePropositions: [],
        approvedClaims: [],
        prohibitedClaims: [],
      },
    });
    const draft = await db.outreachDraft.create({
      data: {
        organisationId: ctx.organisation.id,
        accountId,
        contactId: contact.id,
        playbookId: playbook.id,
        language: "de",
        subject: "Hallo Erika Beispiel",
        body: "Sehr geehrte Frau Beispiel …",
        evidenceIds: [],
      },
    });

    await eraseGrowthContact(ctx, contact.id, "Art. 17 request");

    const after = await db.growthContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.firstName).toBeNull();
    expect(after.email).toBeNull();
    expect(after.redactedAt).not.toBeNull();
    const draftAfter = await db.outreachDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(draftAfter.body).not.toContain("Beispiel");
    expect(draftAfter.redactedAt).not.toBeNull();
    // The objection survives the erasure.
    expect(await isEmailSuppressed(ctx, "erika@erase.example")).toBe(true);
    const audits = await db.auditEvent.findMany({
      where: { eventType: "growth.contact_erased" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("erika");
  });

  it("prospect retention redacts stale contacts of closed accounts only", async () => {
    const ctx = await makeCtx("org-a");
    const closed = await createGrowthAccount(ctx, accountInput("Old GmbH", "old.example"));
    const active = await createGrowthAccount(ctx, accountInput("Live GmbH", "live.example"));
    const closedId = (closed as { accountId: string }).accountId;
    const activeId = (active as { accountId: string }).accountId;
    await transitionGrowthAccount(ctx, closedId, "NEEDS_REVIEW");
    await transitionGrowthAccount(ctx, closedId, "REJECTED");
    for (const [accountId, email] of [
      [closedId, "stale@old.example"],
      [activeId, "fresh@live.example"],
    ] as const) {
      await db.growthContact.create({
        data: {
          organisationId: ctx.organisation.id,
          accountId,
          firstName: "P",
          email,
          emailNormalized: email,
        },
      });
    }
    const old = new Date(Date.now() - 500 * 86_400_000);
    await db.$executeRawUnsafe(
      'UPDATE "GrowthContact" SET "updatedAt" = $1',
      old,
    );
    const sweep = await redactExpiredGrowthContacts();
    expect(sweep.redacted).toBe(1);
    const stale = await db.growthContact.findFirstOrThrow({
      where: { accountId: closedId },
    });
    expect(stale.email).toBeNull();
    expect(stale.redactedAt).not.toBeNull();
    const fresh = await db.growthContact.findFirstOrThrow({
      where: { accountId: activeId },
    });
    expect(fresh.email).toBe("fresh@live.example");
  });
});

const CSV = [
  "Firma,Website,Stadt,land,Vorname,Nachname,contact email",
  "Fenster Neu GmbH,https://fenster-neu.example,Hamburg,DE,Max,Muster,max@fenster-neu.example",
  "Renovex Zwei AG,renovex-zwei.example,Köln,DE,,,",
  ",missing-name.example,Berlin,DE,,,",
].join("\n");

describeDb("growth G2: target profile lifecycle machine", () => {
  it("enforces DRAFT→ACTIVE→PAUSED→ACTIVE/ARCHIVED with ARCHIVED terminal", async () => {
    const ctx = await makeCtx("org-a");
    const profile = await createTargetProfile(ctx, { name: "Machine Profile" });
    await expect(
      setTargetProfileStatus(ctx, profile.id, "PAUSED"),
    ).rejects.toThrow(/cannot move DRAFT/);
    await setTargetProfileStatus(ctx, profile.id, "ACTIVE");
    await setTargetProfileStatus(ctx, profile.id, "PAUSED");
    await setTargetProfileStatus(ctx, profile.id, "ACTIVE");
    await setTargetProfileStatus(ctx, profile.id, "ARCHIVED");
    await expect(
      setTargetProfileStatus(ctx, profile.id, "ACTIVE"),
    ).rejects.toThrow(/cannot move ARCHIVED/);
    await expect(
      setTargetProfileStatus(ctx, profile.id, "DRAFT"),
    ).rejects.toThrow(/cannot move ARCHIVED/);
  });
});

describeDb("growth G2: csv import", () => {
  it("preview requires an ACTIVE profile of the current organisation", async () => {
    const ctx = await makeCtx("org-a");
    const draft = await createTargetProfile(ctx, { name: "Draft P" });
    await expect(
      previewImport(ctx, { filename: "x.csv", text: CSV, targetProfileId: draft.id }),
    ).rejects.toThrow(/ACTIVE target profile/);
    const foreign = await makeCtx("org-b");
    const foreignProfile = await activeProfileId(foreign);
    await expect(
      previewImport(ctx, { filename: "x.csv", text: CSV, targetProfileId: foreignProfile }),
    ).rejects.toThrow(/not found/);
    expect(await db.growthImport.count()).toBe(0);
  });

  it("preview writes nothing; commit binds the previewed profile and needs explicit partial", async () => {
    const ctx = await makeCtx("org-a");
    const profileId = await activeProfileId(ctx);
    const preview = await previewImport(ctx, {
      filename: "test.csv",
      text: CSV,
      targetProfileId: profileId,
    });
    expect(preview.targetProfileId).toBe(profileId);
    expect(preview.invalidRows).toEqual([{ rowNumber: 4, errors: ["missing_name"] }]);
    expect(await db.growthAccount.count()).toBe(0);
    expect(await db.growthContact.count()).toBe(0);

    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "test.csv",
        text: CSV,
        resolutions: {},
        acceptPartial: false,
      }),
    ).rejects.toThrow(/confirm partial import/);

    const result = await commitImport(ctx, {
      importId: preview.importId,
      filename: "test.csv",
      text: CSV,
      resolutions: {},
      acceptPartial: true,
    });
    expect(result.accepted).toBe(2);
    // Every created account carries the profile bound AT PREVIEW.
    const accounts = await db.growthAccount.findMany();
    expect(accounts).toHaveLength(2);
    for (const account of accounts) {
      expect(account.targetProfileId).toBe(profileId);
    }
    const audits = await db.auditEvent.findMany({
      where: { eventType: { in: ["growth.import_previewed", "growth.import_committed"] } },
    });
    expect(JSON.stringify(audits)).not.toContain("Fenster Neu");
    expect(JSON.stringify(audits)).not.toContain("max@");
    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "test.csv",
        text: CSV,
        resolutions: {},
        acceptPartial: true,
      }),
    ).rejects.toThrow(/already committed/);
  });

  it("a changed mapping at commit refuses and writes NO domain rows", async () => {
    const ctx = await makeCtx("org-a");
    const profileId = await activeProfileId(ctx);
    const preview = await previewImport(ctx, {
      filename: "m.csv",
      text: CSV,
      targetProfileId: profileId,
    });
    const tampered = { ...preview.mapping, Stadt: "region" as const };
    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "m.csv",
        text: CSV,
        mapping: tampered,
        resolutions: {},
        acceptPartial: true,
      }),
    ).rejects.toThrow(/mapping changed since preview/);
    expect(await db.growthAccount.count()).toBe(0);
    expect(await db.growthContact.count()).toBe(0);
    expect(await db.accountSourceRecord.count()).toBe(0);
    const record = await db.growthImport.findUniqueOrThrow({
      where: { id: preview.importId },
    });
    expect(record.status).toBe("PREVIEWED");
  });

  it("duplicate resolutions are validated server-side; arbitrary link targets refuse", async () => {
    const ctx = await makeCtx("org-a");
    const profileId = await activeProfileId(ctx);
    const otherProfile = await activeProfileId(ctx);
    const existing = await createGrowthAccount(ctx, {
      name: "Fenster Neu GmbH",
      domain: "fenster-neu.example",
      country: "DE",
      targetProfileId: otherProfile,
      source: { provider: "test" },
    });
    const existingId = (existing as { accountId: string }).accountId;
    const bystander = await createGrowthAccount(ctx, {
      name: "Unrelated GmbH",
      domain: "unrelated.example",
      country: "DE",
      source: { provider: "test" },
    });
    const bystanderId = (bystander as { accountId: string }).accountId;

    const csv = [
      "Firma,Website,land,Vorname",
      "Fenster Neu GmbH,fenster-neu.example,DE,Mira", // exact duplicate
      "Saubere Firma GmbH,saubere.example,DE,",       // clean row
    ].join("\n");
    const preview = await previewImport(ctx, {
      filename: "r.csv",
      text: csv,
      targetProfileId: profileId,
    });
    const base = {
      importId: preview.importId,
      filename: "r.csv",
      text: csv,
      acceptPartial: false,
    };
    // Resolution for a non-duplicate row.
    await expect(
      commitImport(ctx, { ...base, resolutions: { 3: "skip" } }),
    ).rejects.toThrow(/not a duplicate/);
    // Arbitrary same-organisation link target.
    await expect(
      commitImport(ctx, { ...base, resolutions: { 2: `link:${bystanderId}` } }),
    ).rejects.toThrow(/does not match the detected candidate/);
    // Malformed value.
    await expect(
      commitImport(ctx, { ...base, resolutions: { 2: "merge" } }),
    ).rejects.toThrow(/invalid resolution/);
    // 'new' for an exact domain duplicate.
    await expect(
      commitImport(ctx, { ...base, resolutions: { 2: "new" } }),
    ).rejects.toThrow(/can only be skipped or linked/);
    expect(await db.growthAccount.count()).toBe(2); // nothing imported yet

    // The correct link succeeds, changes NOTHING on the target (including
    // its profile), and adds only provenance + the contact.
    const before = await db.growthAccount.findUniqueOrThrow({ where: { id: existingId } });
    const result = await commitImport(ctx, {
      ...base,
      resolutions: { 2: `link:${existingId}` },
    });
    expect(result.linked).toBe(1);
    expect(result.accepted).toBe(1);
    const after = await db.growthAccount.findUniqueOrThrow({ where: { id: existingId } });
    expect(after.targetProfileId).toBe(otherProfile);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.city).toBe(before.city);
    expect(
      await db.accountSourceRecord.count({
        where: { accountId: existingId, duplicateOfAccountId: existingId },
      }),
    ).toBe(1);
    expect(
      await db.growthContact.count({ where: { accountId: existingId } }),
    ).toBe(1);
  });

  it("suppression precedence: domain and contact evaluated independently", async () => {
    const ctx = await makeCtx("org-a");
    const profileId = await activeProfileId(ctx);
    // Erased contact (tombstone) + suppressed domain on the SAME row, plus a
    // suppressed (non-erased) contact + suppressed domain on another.
    await db.suppressionEntry.createMany({
      data: [
        {
          organisationId: ctx.organisation.id,
          emailNormalized: "gone@combined.example",
          reason: "erasure",
          source: "privacy",
        },
        {
          organisationId: ctx.organisation.id,
          emailNormalized: "optout@combined2.example",
          reason: "requested",
          source: "manual",
        },
        {
          organisationId: ctx.organisation.id,
          emailNormalized: "domain:combined.example",
          domainNormalized: "combined.example",
          reason: "requested",
          source: "manual",
        },
        {
          organisationId: ctx.organisation.id,
          emailNormalized: "domain:combined2.example",
          domainNormalized: "combined2.example",
          reason: "requested",
          source: "manual",
        },
      ],
    });
    const csv = [
      "Firma,Website,contact email",
      "Combined GmbH,combined.example,gone@combined.example",
      "Combined Zwei GmbH,combined2.example,optout@combined2.example",
    ].join("\n");
    const preview = await previewImport(ctx, {
      filename: "cs.csv",
      text: csv,
      targetProfileId: profileId,
    });
    expect(preview.suppressedRows).toEqual(
      expect.arrayContaining([
        { rowNumber: 2, contactCode: "contact_erased_tombstone", domainCode: "domain_suppressed" },
        { rowNumber: 3, contactCode: "contact_suppressed", domainCode: "domain_suppressed" },
      ]),
    );
    const result = await commitImport(ctx, {
      importId: preview.importId,
      filename: "cs.csv",
      text: csv,
      resolutions: {},
      acceptPartial: false,
    });
    expect(result.accepted).toBe(2);
    expect(result.tombstoneSkippedContacts).toBe(1);
    // BOTH accounts import directly as SUPPRESSED — domain suppression wins
    // regardless of the contact situation.
    const one = await db.growthAccount.findFirstOrThrow({
      where: { domainNormalized: "combined.example" },
      include: { contacts: true },
    });
    expect(one.status).toBe("SUPPRESSED");
    expect(one.suppressedAt).not.toBeNull();
    expect(one.contacts).toHaveLength(0); // the erased person did not return
    const two = await db.growthAccount.findFirstOrThrow({
      where: { domainNormalized: "combined2.example" },
      include: { contacts: true },
    });
    expect(two.status).toBe("SUPPRESSED");
    expect(two.contacts).toHaveLength(1);
    expect(two.contacts[0]!.suppressedAt).not.toBeNull();
  });

  it("a tombstoned contact alone does not block the account import", async () => {
    const ctx = await makeCtx("org-a");
    const profileId = await activeProfileId(ctx);
    await db.suppressionEntry.create({
      data: {
        organisationId: ctx.organisation.id,
        emailNormalized: "erased@lonely.example",
        reason: "erasure",
        source: "privacy",
      },
    });
    const csv = [
      "Firma,Website,contact email",
      "Lonely GmbH,lonely.example,erased@lonely.example",
    ].join("\n");
    const preview = await previewImport(ctx, {
      filename: "t.csv",
      text: csv,
      targetProfileId: profileId,
    });
    const result = await commitImport(ctx, {
      importId: preview.importId,
      filename: "t.csv",
      text: csv,
      resolutions: {},
      acceptPartial: false,
    });
    expect(result.accepted).toBe(1);
    expect(result.tombstoneSkippedContacts).toBe(1);
    const account = await db.growthAccount.findFirstOrThrow({
      where: { domainNormalized: "lonely.example" },
      include: { contacts: true },
    });
    expect(account.status).toBe("NEEDS_REVIEW"); // company imports normally
    expect(account.contacts).toHaveLength(0);    // the person does not
  });

  it("commit refuses stale content and cross-tenant records; exactly one concurrent commit wins", async () => {
    const ctx = await makeCtx("org-a");
    const profileId = await activeProfileId(ctx);
    const preview = await previewImport(ctx, {
      filename: "c.csv",
      text: CSV,
      targetProfileId: profileId,
    });
    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "c.csv",
        text: CSV + "\nExtra GmbH,extra.example,,,,,",
        resolutions: {},
        acceptPartial: true,
      }),
    ).rejects.toThrow(/changed since preview/);
    const foreign = await makeCtx("org-b");
    await expect(
      commitImport(foreign, {
        importId: preview.importId,
        filename: "c.csv",
        text: CSV,
        resolutions: {},
        acceptPartial: true,
      }),
    ).rejects.toThrow(/not found/);

    // Concurrency: two commits race; the atomic claim lets exactly one pass.
    const attempt = () =>
      commitImport(ctx, {
        importId: preview.importId,
        filename: "c.csv",
        text: CSV,
        resolutions: {},
        acceptPartial: true,
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /already committed or is being committed/,
    );
    // No duplicate audit or provenance from the losing commit.
    expect(
      await db.auditEvent.count({ where: { eventType: "growth.import_committed" } }),
    ).toBe(1);
    expect(
      await db.accountSourceRecord.count({ where: { importBatchId: preview.importId } }),
    ).toBe(2);
    expect(await db.growthAccount.count()).toBe(2);
  });
});

describeDb("growth G2: account editing and assignment", () => {
  it("edits are validated, audited by field name, and cannot bypass suppression", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, {
      name: "Edit Me GmbH",
      domain: "edit-me.example",
      country: "DE",
      source: { provider: "test" },
    });
    const accountId = (created as { accountId: string }).accountId;
    await updateGrowthAccount(ctx, accountId, { city: "Bremen", country: "de" });
    const account = await db.growthAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.city).toBe("Bremen");
    expect(account.country).toBe("DE");
    const audits = await db.auditEvent.findMany({
      where: { eventType: "growth.account_updated" },
    });
    expect(JSON.stringify(audits[0]!.afterMetadata)).toContain("city");
    expect(JSON.stringify(audits[0]!.afterMetadata)).not.toContain("Bremen");

    // Editing the domain onto a suppressed one re-applies suppression.
    await db.suppressionEntry.create({
      data: {
        organisationId: ctx.organisation.id,
        emailNormalized: "domain:verboten.example",
        domainNormalized: "verboten.example",
        reason: "requested",
        source: "manual",
      },
    });
    await updateGrowthAccount(ctx, accountId, { domain: "verboten.example" });
    const suppressed = await db.growthAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(suppressed.status).toBe("SUPPRESSED");
    expect(suppressed.suppressedAt).not.toBeNull();

    const operator = await makeCtx("org-a", "OPERATOR");
    await expect(
      updateGrowthAccount(operator, accountId, { city: "X" }),
    ).rejects.toThrow(/Missing permission/);
  });

  it("assignment requires an active same-organisation membership and is audited", async () => {
    const orgA = await makeCtx("org-a");
    const orgB = await makeCtx("org-b");
    const created = await createGrowthAccount(orgA, {
      name: "Assign GmbH",
      domain: "assign.example",
      country: "DE",
      source: { provider: "test" },
    });
    const accountId = (created as { accountId: string }).accountId;
    await expect(
      assignGrowthAccount(orgA, accountId, orgB.membership.id),
    ).rejects.toThrow(/active member/);
    await assignGrowthAccount(orgA, accountId, orgA.membership.id);
    const account = await db.growthAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.ownerMembershipId).toBe(orgA.membership.id);
    expect(
      await db.activity.count({ where: { activityType: "growth.account_assigned" } }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({ where: { eventType: "growth.account_assigned" } }),
    ).toBe(1);
  });
});
