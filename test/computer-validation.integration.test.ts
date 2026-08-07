import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Computer C4.1 — controlled execution validation, against a real
 * PostgreSQL database.
 *
 * C4.1 adds NO browser authority: it records refusals (previously silent),
 * a coarse human usefulness signal, and derives metrics from existing
 * domain state. These tests prove the evidence is collected, that it is
 * free of page content, and that the C4 security envelope is unchanged.
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
  attachComputerBridgeByToken,
  createComputerBridgeGrant,
  createComputerSession,
  detachComputerBridgeByToken,
  recordBridgeSnapshot,
} = await import("@/lib/services/computer");
const {
  claimNavigationCommand,
  issueNavigationNonce,
  proposeSafeNavigation,
  reportNavigationResult,
} = await import("@/lib/services/computer-navigation");
const { decideApproval } = await import("@/lib/services/approvals");
const {
  buildComputerValidationReport,
  listValidationRuns,
  recordValidationAssessment,
} = await import("@/lib/services/computer-validation");

async function makeCtx(slug: string, role: "ADMIN" | "OPERATOR" = "ADMIN") {
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

type Ctx = Awaited<ReturnType<typeof makeCtx>>;

const PAGE_URL = "https://deposit.fictionbank.test/eur/swift";
const ORDERS_URL = "https://deposit.fictionbank.test/orders";
/** Sensitive-looking material that must never reach validation output. */
const SECRET = "s3cr3t-session-value";

function payload(links = [{ ref: "l0", name: "Orders", href: "/orders" }], over = {}) {
  return {
    url: PAGE_URL,
    title: "Deposit EUR — FictionBank",
    visibleText: `Deposit EUR via SWIFT. Reference ${SECRET}. Arrives in 0-5 business days.`,
    elements: [{ role: "link", name: "Orders" }],
    captureId: `cap-${Math.random().toString(36).slice(2)}`,
    links,
    ...over,
  };
}

async function observed(ctx: Ctx, body = payload()) {
  const session = await createComputerSession(ctx, { goal: "Find my €200 transfer" });
  const grant = await createComputerBridgeGrant(ctx, session.id);
  await attachComputerBridgeByToken(grant.token);
  const snapshot = await recordBridgeSnapshot(grant.token, body);
  return { session, grant, snapshotId: snapshot.snapshotId };
}

async function approvedNavigation(ctx: Ctx) {
  const base = await observed(ctx);
  const { action } = await proposeSafeNavigation(
    ctx,
    base.session.id,
    { ref: "l0" },
    "Check whether the transfer appears in Orders",
  );
  const approval = await db.approvalRequest.findFirstOrThrow({
    where: { sourceType: "COMPUTER_ACTION", sourceId: action.id },
  });
  await decideApproval(ctx, approval.id, "APPROVED");
  return { ...base, action, approvalId: approval.id };
}

beforeEach(async () => {
  process.env.OPERANTO_COMPUTER_BRIDGE_ENABLED = "1";
  process.env.OPERANTO_COMPUTER_GUIDE_ENABLED = "1";
  process.env.OPERANTO_COMPUTER_NAVIGATION_ENABLED = "1";
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Organisation", "User" RESTART IDENTITY CASCADE',
  );
});

afterEach(() => {
  delete process.env.OPERANTO_COMPUTER_BRIDGE_ENABLED;
  delete process.env.OPERANTO_COMPUTER_GUIDE_ENABLED;
  delete process.env.OPERANTO_COMPUTER_NAVIGATION_ENABLED;
  delete process.env.OPERANTO_COMPUTER_VALIDATION_CAMPAIGN;
});

afterAll(async () => {
  await db.$disconnect();
});

describeDb("refusals become evidence (previously silent)", () => {
  it("records a stale snapshot refusal with an enum reason and no page data", async () => {
    const ctx = await makeCtx("org-a");
    const base = await observed(ctx);
    await db.computerSnapshot.update({
      where: { id: base.snapshotId },
      data: { createdAt: new Date(Date.now() - 30 * 60_000) },
    });
    await expect(
      proposeSafeNavigation(ctx, base.session.id, { ref: "l0" }, "why"),
    ).rejects.toThrow(/too old/);

    const refusal = await db.auditEvent.findFirstOrThrow({
      where: { organisationId: ctx.organisation.id, eventType: "computer.navigation.refused" },
    });
    expect((refusal.afterMetadata as { reason: string }).reason).toBe("STALE_SNAPSHOT");
    const blob = JSON.stringify(refusal);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain("Orders");
    expect(blob).not.toContain("fictionbank");
  });

  it("records ambiguity, policy rejection, replay, and detachment distinctly", async () => {
    const ctx = await makeCtx("org-a");

    // Ambiguous target.
    const ambiguous = await observed(
      ctx,
      payload([
        { ref: "a0", name: "Orders", href: "/orders" },
        { ref: "a1", name: "Orders", href: "/orders-2" },
      ]),
    );
    await expect(
      proposeSafeNavigation(ctx, ambiguous.session.id, { name: "Orders" }, "why"),
    ).rejects.toThrow();

    // Replay of a spent credential.
    const nav = await approvedNavigation(ctx);
    const { nonce } = await issueNavigationNonce(ctx, nav.action.id);
    await claimNavigationCommand(nav.grant.token, nonce);
    await expect(claimNavigationCommand(nav.grant.token, nonce)).rejects.toThrow();

    // Detached bridge.
    const detached = await approvedNavigation(ctx);
    const second = await issueNavigationNonce(ctx, detached.action.id);
    await detachComputerBridgeByToken(detached.grant.token);
    await expect(
      claimNavigationCommand(detached.grant.token, second.nonce),
    ).rejects.toThrow();

    const reasons = (
      await db.auditEvent.findMany({
        where: {
          organisationId: ctx.organisation.id,
          eventType: "computer.navigation.refused",
        },
      })
    ).map((row) => (row.afterMetadata as { reason: string }).reason);
    expect(reasons).toContain("AMBIGUOUS_TARGET");
    expect(reasons).toContain("REPLAYED_CREDENTIAL");
    expect(reasons).toContain("BRIDGE_DETACHED");
  });

  it("counts dropped unsafe link candidates without recording which links", async () => {
    const ctx = await makeCtx("org-a");
    await observed(
      ctx,
      payload([
        { ref: "l0", name: "Orders", href: "/orders" },
        { ref: "l1", name: "Evil", href: "https://attacker.example/steal" },
        { ref: "l2", name: "Token", href: `/orders?token=${SECRET}` },
      ]),
    );
    const snapshotAudit = await db.auditEvent.findFirstOrThrow({
      where: {
        organisationId: ctx.organisation.id,
        eventType: "computer.snapshot.recorded",
      },
    });
    const meta = snapshotAudit.afterMetadata as {
      droppedLinkCount: number;
      safeLinkCount: number;
    };
    expect(meta.droppedLinkCount).toBe(2);
    expect(meta.safeLinkCount).toBe(1);
    expect(JSON.stringify(snapshotAudit)).not.toContain(SECRET);
    expect(JSON.stringify(snapshotAudit)).not.toContain("attacker.example");
  });
});

describeDb("validation report", () => {
  it("aggregates a full approved+verified navigation from existing state", async () => {
    const ctx = await makeCtx("org-a");
    const nav = await approvedNavigation(ctx);
    const { nonce } = await issueNavigationNonce(ctx, nav.action.id);
    await claimNavigationCommand(nav.grant.token, nonce);
    await recordBridgeSnapshot(
      nav.grant.token,
      payload([{ ref: "o0", name: "Back", href: "/eur/swift" }], { url: ORDERS_URL }),
    );
    await reportNavigationResult(nav.grant.token, nav.action.id, { ok: true });

    const report = await buildComputerValidationReport(ctx);
    expect(report.navigations.proposed).toBe(1);
    expect(report.navigations.approved).toBe(1);
    expect(report.navigations.executed).toBe(1);
    expect(report.navigations.verified).toBe(1);
    expect(report.navigations.approvalAgreementRate).toBe(100);
    expect(report.navigations.verificationRate).toBe(100);
    // No invariant may be breached by a normal successful run.
    expect(report.invariants).toEqual({
      unauthorizedSideEffects: 0,
      crossOriginEscapes: 0,
      replaySuccesses: 0,
      sensitiveUrlPersistence: 0,
    });
  });

  it("classifies a rejected proposal and an inconclusive verification", async () => {
    const ctx = await makeCtx("org-a");
    // Rejected by the human.
    const rejected = await observed(ctx);
    const proposal = await proposeSafeNavigation(
      ctx,
      rejected.session.id,
      { ref: "l0" },
      "why",
    );
    const approval = await db.approvalRequest.findFirstOrThrow({
      where: { sourceType: "COMPUTER_ACTION", sourceId: proposal.action.id },
    });
    await decideApproval(ctx, approval.id, "REJECTED");

    // Approved but landing on the wrong page → INCONCLUSIVE.
    const nav = await approvedNavigation(ctx);
    const { nonce } = await issueNavigationNonce(ctx, nav.action.id);
    await claimNavigationCommand(nav.grant.token, nonce);
    await recordBridgeSnapshot(
      nav.grant.token,
      payload([], { url: "https://deposit.fictionbank.test/elsewhere" }),
    );
    await reportNavigationResult(nav.grant.token, nav.action.id, { ok: true });

    const report = await buildComputerValidationReport(ctx);
    expect(report.navigations.rejected).toBe(1);
    expect(report.navigations.inconclusive).toBe(1);
    expect(report.navigations.approvalAgreementRate).toBe(50);
    expect(report.failures.USER_REJECTED).toBe(1);
    expect(report.failures.VERIFICATION_INCONCLUSIVE).toBe(1);
  });

  it("contains NO page content anywhere in the report or the run list", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await db.customer.create({
      data: { organisationId: ctx.organisation.id, name: "Anna Muller" },
    });
    const session = await createComputerSession(ctx, {
      goal: `Find Anna Muller's transfer, reference ${SECRET}`,
      customerId: customer.id,
    });
    const grant = await createComputerBridgeGrant(ctx, session.id);
    await attachComputerBridgeByToken(grant.token);
    await recordBridgeSnapshot(grant.token, payload());
    await proposeSafeNavigation(ctx, session.id, { ref: "l0" }, "check orders");

    const blob = JSON.stringify([
      await buildComputerValidationReport(ctx),
      await listValidationRuns(ctx),
    ]);
    for (const forbidden of [
      SECRET,
      "Anna Muller",
      "Deposit EUR",
      "FictionBank",
      "Orders",
      "/orders",
      "SWIFT",
      "check orders",
      "business days",
    ]) {
      expect(blob).not.toContain(forbidden);
    }
    // Origin is deliberately present as operational metadata.
    expect(JSON.stringify(await listValidationRuns(ctx))).toContain(
      "https://deposit.fictionbank.test",
    );
  });

  it("groups by validation campaign without a schema change", async () => {
    const ctx = await makeCtx("org-a");
    process.env.OPERANTO_COMPUTER_VALIDATION_CAMPAIGN = "c41-pilot-1";
    const base = await observed(ctx);
    await db.computerSnapshot.update({
      where: { id: base.snapshotId },
      data: { createdAt: new Date(Date.now() - 30 * 60_000) },
    });
    await expect(
      proposeSafeNavigation(ctx, base.session.id, { ref: "l0" }, "why"),
    ).rejects.toThrow();

    const inCampaign = await buildComputerValidationReport(ctx, {
      campaign: "c41-pilot-1",
    });
    expect(inCampaign.failures.STALE_SNAPSHOT).toBe(1);
    const otherCampaign = await buildComputerValidationReport(ctx, {
      campaign: "c41-pilot-2",
    });
    expect(otherCampaign.failures.STALE_SNAPSHOT).toBe(0);
  });

  it("requires computer:read, and never leaks across organisations", async () => {
    const a = await makeCtx("org-a");
    const b = await makeCtx("org-b");
    const operator = await makeCtx("org-a", "OPERATOR");
    await approvedNavigation(a);

    await expect(buildComputerValidationReport(operator)).rejects.toThrow(
      "Missing permission: computer:read",
    );
    const foreign = await buildComputerValidationReport(b);
    expect(foreign.navigations.proposed).toBe(0);
    expect(await listValidationRuns(b)).toHaveLength(0);
  });
});

describeDb("human usefulness signal", () => {
  it("records an enum assessment as an audit event — no schema, no free text", async () => {
    const ctx = await makeCtx("org-a");
    const nav = await approvedNavigation(ctx);
    await recordValidationAssessment(ctx, nav.action.id, "USEFUL");

    const report = await buildComputerValidationReport(ctx);
    expect(report.assessments.USEFUL).toBe(1);

    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organisationId: ctx.organisation.id,
        eventType: "computer.validation.assessed",
      },
    });
    expect((event.afterMetadata as { assessment: string }).assessment).toBe("USEFUL");
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it("WRONG_RECOMMENDATION also counts as a failure signal", async () => {
    const ctx = await makeCtx("org-a");
    const nav = await approvedNavigation(ctx);
    await recordValidationAssessment(ctx, nav.action.id, "WRONG_RECOMMENDATION");
    const report = await buildComputerValidationReport(ctx);
    expect(report.assessments.WRONG_RECOMMENDATION).toBe(1);
    expect(report.failures.WRONG_RECOMMENDATION).toBe(1);
  });

  it("rejects unknown assessments and foreign actions", async () => {
    const a = await makeCtx("org-a");
    const b = await makeCtx("org-b");
    const nav = await approvedNavigation(a);
    await expect(
      recordValidationAssessment(a, nav.action.id, "VERY_USEFUL" as never),
    ).rejects.toThrow("Unknown assessment");
    await expect(
      recordValidationAssessment(b, nav.action.id, "USEFUL"),
    ).rejects.toThrow("not found");
  });
});

describeDb("C4 authority is unchanged by C4.1", () => {
  it("adds no executable action type and no new browser effect", async () => {
    const ctx = await makeCtx("org-a");
    const nav = await approvedNavigation(ctx);
    const { nonce } = await issueNavigationNonce(ctx, nav.action.id);
    await claimNavigationCommand(nav.grant.token, nonce);
    await recordBridgeSnapshot(
      nav.grant.token,
      payload([{ ref: "o0", name: "Back", href: "/eur/swift" }], { url: ORDERS_URL }),
    );
    await reportNavigationResult(nav.grant.token, nav.action.id, { ok: true });

    // Exactly one action, of the one permitted type; nothing else executed.
    const actions = await db.computerAction.findMany({
      where: { organisationId: ctx.organisation.id },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("OPEN_SAFE_LINK");
    expect(
      await db.computerAction.count({
        where: {
          organisationId: ctx.organisation.id,
          actionType: { not: "OPEN_SAFE_LINK" },
          status: { in: ["EXECUTING", "EXECUTED"] },
        },
      }),
    ).toBe(0);

    // Recording evidence does not create or advance any action.
    await recordValidationAssessment(ctx, nav.action.id, "USEFUL");
    const after = await db.computerAction.findUniqueOrThrow({
      where: { id: nav.action.id },
    });
    expect(after.status).toBe("EXECUTED");
    expect(await db.computerAction.count()).toBe(1);
  });
});
