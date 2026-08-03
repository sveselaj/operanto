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

  it("lifecycle transitions are machine-enforced and audited", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, accountInput("Flow GmbH", "flow.example"));
    const accountId = (created as { accountId: string }).accountId;
    await expect(
      transitionGrowthAccount(ctx, accountId, "APPROVED"),
    ).rejects.toThrow(/Invalid account transition/);
    await transitionGrowthAccount(ctx, accountId, "READY_FOR_RESEARCH");
    await transitionGrowthAccount(ctx, accountId, "RESEARCHING");
    await transitionGrowthAccount(ctx, accountId, "READY_FOR_ASSESSMENT");
    await transitionGrowthAccount(ctx, accountId, "APPROVED", "good fit");
    const account = await db.growthAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.status).toBe("APPROVED");
    expect(
      await db.auditEvent.count({ where: { eventType: "growth.account_status_changed" } }),
    ).toBe(4);
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

describeDb("growth G2: target profiles", () => {
  it("creates, updates, archives — audited, tenant-scoped, name-unique", async () => {
    const ctx = await makeCtx("org-a");
    const profile = await createTargetProfile(ctx, {
      name: "DACH Installers",
      regions: ["DE", "AT"],
      companySizeMin: 10,
      companySizeMax: 100,
    });
    await expect(
      createTargetProfile(ctx, { name: "DACH Installers" }),
    ).rejects.toThrow(/already exists/);
    await expect(
      createTargetProfile(ctx, { name: "Bad", companySizeMin: 50, companySizeMax: 10 }),
    ).rejects.toThrow(/cannot exceed/);
    await updateTargetProfile(ctx, profile.id, {
      name: "DACH Installers",
      regions: ["DE"],
    });
    await setTargetProfileStatus(ctx, profile.id, "ACTIVE");
    await setTargetProfileStatus(ctx, profile.id, "ARCHIVED");
    expect(
      await db.auditEvent.count({
        where: { eventType: { in: ["growth.profile_created", "growth.profile_updated", "growth.profile_status_changed"] } },
      }),
    ).toBe(4);

    const foreign = await makeCtx("org-b");
    await expect(
      updateTargetProfile(foreign, profile.id, { name: "Steal" }),
    ).rejects.toThrow(/not found/);
    const operator = await makeCtx("org-a", "OPERATOR");
    await expect(
      createTargetProfile(operator, { name: "Nope" }),
    ).rejects.toThrow(/Missing permission/);
  });
});

describeDb("growth G2: csv import", () => {
  it("preview writes NO domain records; commit requires explicit partial acceptance", async () => {
    const ctx = await makeCtx("org-a");
    const preview = await previewImport(ctx, { filename: "test.csv", text: CSV });
    expect(preview.rowCount).toBe(3);
    expect(preview.invalidRows).toEqual([
      { rowNumber: 4, errors: ["missing_name"] },
    ]);
    expect(await db.growthAccount.count()).toBe(0);
    expect(await db.growthContact.count()).toBe(0);
    expect(await db.growthImport.count()).toBe(1);

    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "test.csv",
        text: CSV,
        mapping: preview.mapping,
        resolutions: {},
        acceptPartial: false,
      }),
    ).rejects.toThrow(/confirm partial import/);

    const result = await commitImport(ctx, {
      importId: preview.importId,
      filename: "test.csv",
      text: CSV,
      mapping: preview.mapping,
      resolutions: {},
      acceptPartial: true,
    });
    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(1);
    const accounts = await db.growthAccount.findMany({ orderBy: { name: "asc" } });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]!.domainNormalized).toBe("fenster-neu.example");
    expect(accounts[0]!.status).toBe("NEEDS_REVIEW");
    expect(await db.growthContact.count()).toBe(1);
    const record = await db.growthImport.findUniqueOrThrow({
      where: { id: preview.importId },
    });
    expect(record.status).toBe("COMMITTED");
    expect(record.acceptedCount).toBe(2);
    // Audit metadata is counts-only — no row content, names or e-mails.
    const audits = await db.auditEvent.findMany({
      where: { eventType: { in: ["growth.import_previewed", "growth.import_committed"] } },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("Fenster Neu");
    expect(JSON.stringify(audits)).not.toContain("max@");
    // Re-committing the same import refuses.
    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "test.csv",
        text: CSV,
        mapping: preview.mapping,
        resolutions: {},
        acceptPartial: true,
      }),
    ).rejects.toThrow(/already committed/);
  });

  it("detects exact + possible duplicates, honours resolutions, never overwrites", async () => {
    const ctx = await makeCtx("org-a");
    await createGrowthAccount(ctx, {
      name: "Fenster Neu GmbH",
      domain: "fenster-neu.example",
      country: "DE",
      source: { provider: "test" },
    });
    await createGrowthAccount(ctx, {
      name: "Alpenglas Montagen GmbH",
      domain: "alpenglas-alt.example",
      country: "DE",
      source: { provider: "test" },
    });
    const csv = [
      "Firma,Website,land,Stadt",
      "Fenster Neu GmbH,fenster-neu.example,DE,Hamburg", // exact (domain)
      "Alpenglas Montagen AG,,DE,", // possible (name+country)
      "Neue Firma GmbH,neue-firma.example,DE,", // clean
      "Neue Firma GmbH,neue-firma.example,DE,", // in-file duplicate
    ].join("\n");
    const preview = await previewImport(ctx, { filename: "d.csv", text: csv });
    expect(preview.duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 2, kind: "exact", reason: "domain_exact" }),
        expect.objectContaining({ rowNumber: 3, kind: "possible", reason: "name_country_match" }),
        expect.objectContaining({ rowNumber: 5, kind: "in_file", reason: "in_file_domain" }),
      ]),
    );
    const exact = preview.duplicates.find((d) => d.reason === "domain_exact")!;
    const before = await db.growthAccount.findFirstOrThrow({
      where: { domainNormalized: "fenster-neu.example" },
    });
    const result = await commitImport(ctx, {
      importId: preview.importId,
      filename: "d.csv",
      text: csv,
      mapping: preview.mapping,
      resolutions: {
        2: `link:${exact.existingAccountId}`,
        3: "new",
        5: "skip",
      },
      acceptPartial: false,
    });
    expect(result.linked).toBe(1);
    expect(result.accepted).toBe(2); // possible-as-new + clean row
    expect(result.skippedDuplicates).toBe(1);
    // Linking added provenance but changed nothing on the account.
    const after = await db.growthAccount.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.city).toBe(before.city);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(
      await db.accountSourceRecord.count({
        where: { accountId: before.id, duplicateOfAccountId: before.id },
      }),
    ).toBe(1);
  });

  it("suppression survives import: tombstones are not recreated, marks persist", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, {
      name: "Erased Host GmbH",
      domain: "erased-host.example",
      country: "DE",
      source: { provider: "test" },
    });
    const accountId = (created as { accountId: string }).accountId;
    const contact = await db.growthContact.create({
      data: {
        organisationId: ctx.organisation.id,
        accountId,
        firstName: "Gone",
        email: "gone@erased-host.example",
        emailNormalized: "gone@erased-host.example",
      },
    });
    await eraseGrowthContact(ctx, contact.id, "Art. 17");

    const csv = [
      "Firma,Website,contact email",
      "Neu Import GmbH,neu-import.example,gone@erased-host.example",
    ].join("\n");
    const preview = await previewImport(ctx, { filename: "s.csv", text: csv });
    expect(preview.suppressedRows).toEqual([
      { rowNumber: 2, code: "contact_erased_tombstone" },
    ]);
    const result = await commitImport(ctx, {
      importId: preview.importId,
      filename: "s.csv",
      text: csv,
      mapping: preview.mapping,
      resolutions: {},
      acceptPartial: false,
    });
    expect(result.tombstoneSkipped).toBe(1);
    expect(result.accepted).toBe(0);
    // The erased identity was NOT recreated anywhere.
    expect(
      await db.growthContact.count({
        where: { emailNormalized: "gone@erased-host.example" },
      }),
    ).toBe(0);
  });

  it("suppressed domains import directly as SUPPRESSED — never reactivated", async () => {
    const ctx = await makeCtx("org-a");
    const created = await createGrowthAccount(ctx, {
      name: "Old Blocked GmbH",
      domain: "blocked.example",
      country: "DE",
      source: { provider: "test" },
    });
    await suppressGrowthAccount(ctx, (created as { accountId: string }).accountId, "no contact");
    // A new import for a DIFFERENT company on the suppressed domain's org…
    const csv = ["Firma,Website", "Blocked Sub GmbH,sub.other.example"].join("\n");
    // …fine; but the same suppressed domain would be domain_exact anyway.
    // Test the marked-import path via a fresh domain suppression:
    await db.suppressionEntry.create({
      data: {
        organisationId: ctx.organisation.id,
        emailNormalized: "domain:fresh-blocked.example",
        domainNormalized: "fresh-blocked.example",
        reason: "requested",
        source: "manual",
      },
    });
    const csv2 = ["Firma,Website", "Fresh Blocked GmbH,fresh-blocked.example"].join("\n");
    const preview = await previewImport(ctx, { filename: "b.csv", text: csv2 });
    expect(preview.suppressedRows).toEqual([{ rowNumber: 2, code: "domain_suppressed" }]);
    await commitImport(ctx, {
      importId: preview.importId,
      filename: "b.csv",
      text: csv2,
      mapping: preview.mapping,
      resolutions: {},
      acceptPartial: false,
    });
    const account = await db.growthAccount.findFirstOrThrow({
      where: { domainNormalized: "fresh-blocked.example" },
    });
    expect(account.status).toBe("SUPPRESSED");
    expect(account.suppressedAt).not.toBeNull();
    void csv;
  });

  it("commit refuses when content changed after preview, and cross-tenant imports fail", async () => {
    const ctx = await makeCtx("org-a");
    const preview = await previewImport(ctx, { filename: "c.csv", text: CSV });
    await expect(
      commitImport(ctx, {
        importId: preview.importId,
        filename: "c.csv",
        text: CSV + "\nExtra GmbH,extra.example,,,,,",
        mapping: preview.mapping,
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
        mapping: preview.mapping,
        resolutions: {},
        acceptPartial: true,
      }),
    ).rejects.toThrow(/not found/);
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
