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
