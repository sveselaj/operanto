import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI handover against a real PostgreSQL database, mock provider throughout.
 * Every control the slice promises — human review, atomic decisions, risk
 * and confidence policy, budgets, tenancy, restriction, erasure — is proven
 * here against real queries, not mocks of queries.
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

const { runAiTask, listAiActions } = await import("@/lib/services/ai");
const {
  applyApprovedDraft,
  decideApproval,
  editApprovalDraft,
  getConversationApproval,
} = await import("@/lib/services/approvals");
const { getAiConfiguration, updateAiConfiguration } = await import(
  "@/lib/services/ai-config"
);
const {
  addManualMessage,
  createManualConversation,
  setConversationHandling,
} = await import("@/lib/services/conversations");
const { eraseCustomer, redactExpiredMessages, setProcessingRestriction } =
  await import("@/lib/services/privacy");
const { AIError } = await import("@/lib/ai/types");

const NAGELISTA =
  "Hello, I ordered a nail set last week. Can you tell me whether it has been shipped?";

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

type Ctx = Awaited<ReturnType<typeof makeCtx>>;

async function enableAi(ctx: Ctx) {
  await getAiConfiguration(ctx);
  await updateAiConfiguration(ctx, { enabled: true });
}

async function conversationWithInbound(ctx: Ctx, body = NAGELISTA, name = "Test person") {
  const customer = await db.customer.create({
    data: { organisationId: ctx.organisation.id, name },
  });
  const conversation = await createManualConversation(ctx, {
    customerId: customer.id,
    subject: "AI fixture",
  });
  await db.message.create({
    data: {
      organisationId: ctx.organisation.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      body,
    },
  });
  return { customer, conversation };
}

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Organisation", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describeDb("AI task execution (mock mode)", () => {
  it("is disabled by default and refuses with a clear code", async () => {
    const ctx = await makeCtx("org-a");
    const { conversation } = await conversationWithInbound(ctx);
    await expect(runAiTask(ctx, conversation.id, "SUMMARY")).rejects.toMatchObject({
      code: "AI_DISABLED",
    });
  });

  it("runs summary, classification and next-action, persisting AIActions", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);

    const summary = await runAiTask(ctx, conversation.id, "SUMMARY");
    expect(summary.status).toBe("COMPLETED");
    expect(summary.provider).toBe("mock");
    expect(summary.confidence).toBeGreaterThan(0);

    const classification = await runAiTask(ctx, conversation.id, "CLASSIFICATION");
    expect(
      (classification.outputJson as { primaryIntent?: string }).primaryIntent,
    ).toBe("ORDER_STATUS");

    await runAiTask(ctx, conversation.id, "NEXT_ACTION");
    const actions = await listAiActions(ctx, conversation.id);
    expect(actions).toHaveLength(3);

    // Input summaries are PII-reduced: counts and flags only.
    const blob = JSON.stringify(actions.map((a) => a.inputSummary));
    expect(blob).not.toContain("nail set");
    expect(blob).not.toContain("Test person");
  });

  it("a regenerated result supersedes the previous one", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);
    const first = await runAiTask(ctx, conversation.id, "SUMMARY");
    await runAiTask(ctx, conversation.id, "SUMMARY");
    const reloaded = await db.aIAction.findUnique({ where: { id: first.id } });
    expect(reloaded!.status).toBe("SUPERSEDED");
  });

  it("record-level scope: an operator cannot run AI on an unassigned conversation", async () => {
    const admin = await makeCtx("org-a", "ADMIN");
    const operator = await makeCtx("org-a", "OPERATOR");
    await enableAi(admin);
    const { conversation } = await conversationWithInbound(admin);
    await expect(runAiTask(operator, conversation.id, "SUMMARY")).rejects.toThrow(
      "Conversation not found",
    );
  });

  it("cross-tenant AIAction and approval access is impossible", async () => {
    const ctxA = await makeCtx("org-a");
    const ctxB = await makeCtx("org-b");
    await enableAi(ctxA);
    const { conversation } = await conversationWithInbound(ctxA);
    await runAiTask(ctxA, conversation.id, "REPLY_DRAFT");

    await expect(listAiActions(ctxB, conversation.id)).rejects.toThrow(
      "Conversation not found",
    );
    expect(await getConversationApproval(ctxB, conversation.id)).toBeNull();
    const approval = await getConversationApproval(ctxA, conversation.id);
    await expect(decideApproval(ctxB, approval!.id, "APPROVED")).rejects.toThrow(
      "Approval request not found",
    );
  });

  it("restriction blocks AI before any provider or config work", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { customer, conversation } = await conversationWithInbound(ctx);
    await setProcessingRestriction(ctx, customer.id, true);
    await expect(runAiTask(ctx, conversation.id, "SUMMARY")).rejects.toMatchObject({
      code: "PROCESSING_RESTRICTED",
    });
    expect(await db.aIAction.count()).toBe(0);
  });

  it("budget exhaustion blocks AI but never manual handling", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    await updateAiConfiguration(ctx, { monthlyRequestLimit: 1 });
    const { conversation } = await conversationWithInbound(ctx);

    await runAiTask(ctx, conversation.id, "SUMMARY");
    await expect(runAiTask(ctx, conversation.id, "SUMMARY")).rejects.toMatchObject({
      code: "BUDGET_EXHAUSTED",
    });
    const blocked = await db.auditEvent.findFirst({
      where: { eventType: "ai.budget.blocked" },
    });
    expect(blocked).not.toBeNull();

    // Manual conversation operation continues unaffected.
    await addManualMessage(ctx, conversation.id, "manual reply still works");
    expect(
      await db.message.count({ where: { body: "manual reply still works" } }),
    ).toBe(1);
  });

  it("task types can be disallowed per organisation", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    await updateAiConfiguration(ctx, { permittedTaskTypes: ["SUMMARY"] });
    const { conversation } = await conversationWithInbound(ctx);
    await expect(runAiTask(ctx, conversation.id, "REPLY_DRAFT")).rejects.toMatchObject({
      code: "TASK_NOT_PERMITTED",
    });
  });
});

describeDb("draft review and approval", () => {
  it("draft → edit → approve → apply records a manual message exactly once", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");

    const approval = (await getConversationApproval(ctx, conversation.id))!;
    expect(approval.status).toBe("PENDING");

    await editApprovalDraft(ctx, approval.id, "Edited reply for the customer.");
    await decideApproval(ctx, approval.id, "APPROVED");
    await applyApprovedDraft(ctx, approval.id);

    const message = await db.message.findFirst({
      where: { conversationId: conversation.id, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    expect(message!.body).toBe("Edited reply for the customer.");

    // Double execution is impossible.
    await expect(applyApprovedDraft(ctx, approval.id)).rejects.toThrow(
      "already used",
    );
    // The AIAction reflects the decision.
    const action = await db.aIAction.findUnique({ where: { id: approval.sourceId } });
    expect(action!.status).toBe("APPROVED");
  });

  it("approving and applying a draft performs NO external transmission of any kind", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const approval = (await getConversationApproval(ctx, conversation.id))!;

    // Any network attempt during decision or application is a failure: the
    // stub throws, so an outbound call would break the flow loudly.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("EXTERNAL TRANSMISSION ATTEMPTED");
    }) as typeof fetch;
    try {
      await decideApproval(ctx, approval.id, "APPROVED");
      await applyApprovedDraft(ctx, approval.id);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // The result is a LOCAL message: explicit unsent state, no provider ids,
    // and no queue-like artefact anywhere in the schema.
    const message = await db.message.findFirst({
      where: { conversationId: conversation.id, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    expect(message!.deliveryStatus).toBe("RECORDED");
    expect(message!.providerMessageId).toBeNull();
  });

  it("rejection is atomic and cannot be re-decided", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const approval = (await getConversationApproval(ctx, conversation.id))!;

    await decideApproval(ctx, approval.id, "REJECTED", { reason: "not right" });
    await expect(decideApproval(ctx, approval.id, "APPROVED")).rejects.toThrow(
      "already been decided",
    );
    const action = await db.aIAction.findUnique({ where: { id: approval.sourceId } });
    expect(action!.status).toBe("REJECTED");
  });

  it("BLOCKED risk can never be approved", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const approval = (await getConversationApproval(ctx, conversation.id))!;
    await db.approvalRequest.update({
      where: { id: approval.id },
      data: { riskLevel: "BLOCKED" },
    });
    await expect(
      decideApproval(ctx, approval.id, "APPROVED", { acknowledgeLowConfidence: true }),
    ).rejects.toThrow(/BLOCKED/);
    // Rejection is still possible.
    await decideApproval(ctx, approval.id, "REJECTED");
  });

  it("low confidence requires explicit acknowledgement", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    // A generic message produces the deterministic low-confidence draft (0.45).
    const { conversation } = await conversationWithInbound(ctx, "Hi there");
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const approval = (await getConversationApproval(ctx, conversation.id))!;
    expect(approval.lowConfidence).toBe(true);

    await expect(decideApproval(ctx, approval.id, "APPROVED")).rejects.toThrow(
      /acknowledgement/,
    );
    await decideApproval(ctx, approval.id, "APPROVED", {
      acknowledgeLowConfidence: true,
    });
  });

  it("regeneration cancels the previous pending gate", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const first = (await getConversationApproval(ctx, conversation.id))!;
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const reloaded = await db.approvalRequest.findUnique({ where: { id: first.id } });
    expect(reloaded!.status).toBe("CANCELLED");
  });

  it("operators cannot decide approvals", async () => {
    const admin = await makeCtx("org-a", "ADMIN");
    const operator = await makeCtx("org-a", "OPERATOR");
    await enableAi(admin);
    const { conversation } = await conversationWithInbound(admin);
    await runAiTask(admin, conversation.id, "REPLY_DRAFT");
    const approval = (await getConversationApproval(admin, conversation.id))!;
    await expect(decideApproval(operator, approval.id, "APPROVED")).rejects.toThrow(
      /approvals:decide/,
    );
  });
});

describeDb("takeover and release", () => {
  it("flips handling with audit and activity, and AI stays request-only", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx);

    await setConversationHandling(ctx, conversation.id, "HUMAN_CONTROLLED");
    let reloaded = await db.conversation.findUnique({ where: { id: conversation.id } });
    expect(reloaded!.handling).toBe("HUMAN_CONTROLLED");
    expect(reloaded!.handlingChangedByMembershipId).toBe(ctx.membership.id);

    // Explicit requests still work while human-controlled.
    await runAiTask(ctx, conversation.id, "SUMMARY");

    await setConversationHandling(ctx, conversation.id, "AI_ASSISTED");
    reloaded = await db.conversation.findUnique({ where: { id: conversation.id } });
    expect(reloaded!.handling).toBe("AI_ASSISTED");

    const auditTypes = (
      await db.auditEvent.findMany({ where: { targetId: conversation.id } })
    ).map((a) => a.eventType);
    expect(auditTypes).toEqual(
      expect.arrayContaining(["conversation.takeover", "conversation.released"]),
    );
  });
});

describeDb("privacy over AI surfaces", () => {
  it("audit metadata never contains message, draft, or customer content", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { conversation } = await conversationWithInbound(ctx, NAGELISTA, "Vera Krasniqi");
    await runAiTask(ctx, conversation.id, "SUMMARY");
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const approval = (await getConversationApproval(ctx, conversation.id))!;
    await editApprovalDraft(ctx, approval.id, "Dear Vera, secret draft text");
    await decideApproval(ctx, approval.id, "APPROVED");

    const audits = await db.auditEvent.findMany();
    const blob = JSON.stringify(
      audits.map((a) => [a.beforeMetadata, a.afterMetadata]),
    );
    expect(blob).not.toContain("nail set");
    expect(blob).not.toContain("secret draft text");
    expect(blob).not.toContain("Vera");
  });

  it("erasure redacts AI outputs and approval payloads; shell metadata survives", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    const { customer, conversation } = await conversationWithInbound(
      ctx,
      NAGELISTA,
      "Erasa Person",
    );
    await runAiTask(ctx, conversation.id, "SUMMARY");
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");

    const result = await eraseCustomer(ctx, customer.id, "Art. 17");
    expect(result.aiActions).toBeGreaterThanOrEqual(2);

    const [actions, approvals] = await Promise.all([
      db.aIAction.findMany(),
      db.approvalRequest.findMany(),
    ]);
    const blob = JSON.stringify([actions, approvals]);
    expect(blob).not.toContain("nail set");
    expect(blob).not.toContain("Erasa");
    for (const action of actions) {
      expect(action.redactedAt).not.toBeNull();
      // Operational shell survives — the person is not reconstructable.
      expect(action.taskType).toBeTruthy();
      expect(action.provider).toBe("mock");
    }
  });

  it("retention redacts aged AI content on the message window", async () => {
    const ctx = await makeCtx("org-a");
    await enableAi(ctx);
    await db.organisation.update({
      where: { id: ctx.organisation.id },
      data: { messageRetentionDays: 30 },
    });
    const { conversation } = await conversationWithInbound(ctx);
    await runAiTask(ctx, conversation.id, "REPLY_DRAFT");
    const old = new Date(Date.now() - 90 * 86_400_000);
    await db.aIAction.updateMany({ data: { createdAt: old } });
    await db.approvalRequest.updateMany({ data: { requestedAt: old } });

    const sweep = await redactExpiredMessages();
    expect(sweep.aiRedacted).toBeGreaterThanOrEqual(2);
    const blob = JSON.stringify([
      await db.aIAction.findMany(),
      await db.approvalRequest.findMany(),
    ]);
    expect(blob).not.toContain("nail set");
  });

  it("AI failure never blocks manual conversation handling", async () => {
    const ctx = await makeCtx("org-a");
    // AI left DISABLED — the request fails…
    const { conversation } = await conversationWithInbound(ctx);
    await expect(runAiTask(ctx, conversation.id, "SUMMARY")).rejects.toBeInstanceOf(
      AIError,
    );
    // …and everything manual continues.
    await addManualMessage(ctx, conversation.id, "manual continues");
    await setConversationHandling(ctx, conversation.id, "HUMAN_CONTROLLED");
    expect(
      await db.message.count({ where: { body: "manual continues" } }),
    ).toBe(1);
  });
});
