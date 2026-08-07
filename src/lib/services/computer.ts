import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type ComputerAction, type ComputerActionType, type ComputerRiskTier, type ComputerSession, type ComputerStepRoute, type ComputerVerificationResult } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit, auditSystem } from "@/lib/audit";
import { computerBridgeEnabled } from "@/lib/computer-flag";
import {
  BrowserPayloadError,
  sanitizeBrowserPayload,
} from "@/lib/computer/browser-payload";
import { isLowConfidence } from "@/lib/ai/policy";
import { conversationAccessWhere } from "@/lib/services/conversations";
import { taskAccessWhere } from "@/lib/services/tasks";
import {
  ACTION_PROPOSABLE_SESSION_STATUSES,
  CANCELLABLE_ACTION_STATUSES,
  COMPUTER_LIMITS,
  OPEN_SESSION_STATUSES,
  PLAN_PROPOSABLE_SESSION_STATUSES,
  VERIFIABLE_ACTION_STATUSES,
  approvalRiskLevelFor,
  computerApprovalActionType,
  computerSemanticSchema,
  computerTargetSchema,
  initialActionStatusFor,
  isValidConfidence,
  meetsRiskFloor,
  requiresApproval,
} from "@/lib/computer/policy";

/**
 * Computer C1 — domain services for REPRESENTATIONS of governed computer
 * work. Nothing in this module (or anywhere in this slice) drives a browser
 * or performs an external effect; rows describe what a future authorized
 * slice would be allowed to do, under the same spine as everything else:
 * tenant scope on every query, RBAC with the acting human's context,
 * unified ApprovalRequest for R3, ids-only audit, redact-in-place privacy.
 *
 * Structural injection boundary: session goals, plan summaries and action
 * reasons are TRUSTED Operanto control data; snapshot content is UNTRUSTED
 * observation data. No function in this module reads snapshot content to
 * decide policy, status, approval or lifecycle — snapshots are written,
 * linked by id, and redacted; they are never an input to a decision.
 */

function trimmed(value: string, max: number, label: string): string {
  const t = value.trim();
  if (!t || t.length > max) throw new Error(`${label} must be 1–${max} characters`);
  return t;
}

function optionalTrimmed(
  value: string | undefined,
  max: number,
  label: string,
): string | null {
  if (value === undefined || value.trim() === "") return null;
  return trimmed(value, max, label);
}

/* ── Sessions ───────────────────────────────────────────────────────── */

export async function createComputerSession(
  ctx: OrgContext,
  input: {
    goal: string;
    conversationId?: string;
    customerId?: string;
    taskId?: string;
  },
): Promise<ComputerSession> {
  requirePermission(ctx.membership.role, "computer:operate");
  const goal = trimmed(input.goal, COMPUTER_LIMITS.goal, "Goal");

  let customerId = input.customerId ?? null;
  if (input.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { ...conversationAccessWhere(ctx), id: input.conversationId },
      select: { id: true, customer: { select: { id: true, restrictedAt: true } } },
    });
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.customer?.restrictedAt) {
      // Same rule as createTask: restriction halts new work, not just messages.
      throw new Error(
        "Processing for this customer is restricted (GDPR Art. 18) — no new computer work may be created",
      );
    }
    customerId = customerId ?? conversation.customer?.id ?? null;
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { ...scope(ctx), id: customerId },
      select: { id: true, restrictedAt: true, erasedAt: true },
    });
    if (!customer) throw new Error("Customer not found");
    if (customer.restrictedAt) {
      throw new Error(
        "Processing for this customer is restricted (GDPR Art. 18) — no new computer work may be created",
      );
    }
    if (customer.erasedAt) {
      throw new Error("This customer has been erased — no new computer work may reference the tombstone");
    }
  }
  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { ...taskAccessWhere(ctx), id: input.taskId },
      select: { id: true },
    });
    if (!task) throw new Error("Task not found");
  }

  const session = await prisma.computerSession.create({
    data: {
      organisationId: ctx.organisation.id,
      createdByMembershipId: ctx.membership.id,
      conversationId: input.conversationId ?? null,
      customerId,
      taskId: input.taskId ?? null,
      goal,
    },
  });
  if (input.conversationId) {
    // Fixed generic summary — the goal text never enters the timeline.
    await prisma.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: input.conversationId,
        customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "computer.session.created",
        summary: "Computer session created",
        metadata: { computerSessionId: session.id },
      },
    });
  }
  await audit(ctx, {
    eventType: "computer.session.created",
    targetType: "ComputerSession",
    targetId: session.id,
    after: {
      conversationId: session.conversationId,
      customerId: session.customerId,
      taskId: session.taskId,
    },
  });
  return session;
}

export async function listComputerSessions(
  ctx: OrgContext,
  filter: { status?: ComputerSession["status"] } = {},
) {
  requirePermission(ctx.membership.role, "computer:read");
  return prisma.computerSession.findMany({
    where: { ...scope(ctx), ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getComputerSession(ctx: OrgContext, sessionId: string) {
  requirePermission(ctx.membership.role, "computer:read");
  return prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    include: {
      plans: {
        orderBy: { version: "desc" },
        include: { steps: { orderBy: { position: "asc" } } },
      },
      actions: { orderBy: { createdAt: "asc" } },
      snapshots: { orderBy: { createdAt: "asc" } },
    },
  });
}

/* ── Plans ──────────────────────────────────────────────────────────── */

export async function proposeComputerPlan(
  ctx: OrgContext,
  sessionId: string,
  input: {
    summary: string;
    steps: { title: string; plannedRoute: ComputerStepRoute }[];
    aiActionId?: string;
  },
) {
  requirePermission(ctx.membership.role, "computer:operate");
  const summary = trimmed(input.summary, COMPUTER_LIMITS.planSummary, "Plan summary");
  if (input.steps.length === 0 || input.steps.length > COMPUTER_LIMITS.stepsPerPlan) {
    throw new Error(`A plan needs 1–${COMPUTER_LIMITS.stepsPerPlan} steps`);
  }
  const steps = input.steps.map((step, index) => ({
    position: index,
    title: trimmed(step.title, COMPUTER_LIMITS.stepTitle, `Step ${index + 1} title`),
    plannedRoute: step.plannedRoute,
  }));

  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) throw new Error("Computer session not found");
  if (!PLAN_PROPOSABLE_SESSION_STATUSES.includes(session.status)) {
    throw new Error(`A plan cannot be proposed for a ${session.status} session`);
  }
  if (input.aiActionId) {
    const aiAction = await prisma.aIAction.findFirst({
      where: { ...scope(ctx), id: input.aiActionId },
      select: { id: true },
    });
    if (!aiAction) throw new Error("AI action not found");
  }

  try {
    const plan = await prisma.$transaction(async (tx) => {
      const latest = await tx.computerPlan.findFirst({
        where: { sessionId: session.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      // Immutability: the previous intent survives as SUPERSEDED history.
      await tx.computerPlan.updateMany({
        where: { ...scope(ctx), sessionId: session.id, status: "PROPOSED" },
        data: { status: "SUPERSEDED" },
      });
      const plan = await tx.computerPlan.create({
        data: {
          organisationId: ctx.organisation.id,
          sessionId: session.id,
          version: (latest?.version ?? 0) + 1,
          summary,
          aiActionId: input.aiActionId ?? null,
          createdByMembershipId: ctx.membership.id,
          steps: {
            create: steps.map((step) => ({
              organisationId: ctx.organisation.id,
              ...step,
            })),
          },
        },
        include: { steps: { orderBy: { position: "asc" } } },
      });
      // Optimistic status move; re-planning a READY session returns it to
      // PLANNING (legal transition), CREATED enters PLANNING.
      const moved = await tx.computerSession.updateMany({
        where: {
          ...scope(ctx),
          id: session.id,
          status: { in: PLAN_PROPOSABLE_SESSION_STATUSES },
        },
        data: { status: "PLANNING" },
      });
      if (moved.count === 0) {
        throw new Error("The session changed while the plan was being proposed");
      }
      return plan;
    });
    await audit(ctx, {
      eventType: "computer.plan.proposed",
      targetType: "ComputerPlan",
      targetId: plan.id,
      after: {
        sessionId: session.id,
        version: plan.version,
        stepCount: plan.steps.length,
        aiActionId: input.aiActionId ?? null,
      },
    });
    return plan;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // The (sessionId, version) unique lost a concurrent race — nothing
      // was corrupted, the other plan won.
      throw new Error("A plan was proposed concurrently — reload and retry");
    }
    throw error;
  }
}

export async function markComputerSessionReady(
  ctx: OrgContext,
  sessionId: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  const plan = await prisma.computerPlan.findFirst({
    where: { ...scope(ctx), sessionId, status: "PROPOSED" },
    select: { id: true },
  });
  if (!plan) throw new Error("The session has no proposed plan");
  const moved = await prisma.computerSession.updateMany({
    where: { ...scope(ctx), id: sessionId, status: "PLANNING" },
    data: { status: "READY" },
  });
  if (moved.count === 0) throw new Error("Only a PLANNING session can become READY");
  await audit(ctx, {
    eventType: "computer.session.ready",
    targetType: "ComputerSession",
    targetId: sessionId,
    after: { planId: plan.id },
  });
}

/* ── Snapshots ──────────────────────────────────────────────────────── */

export async function recordComputerSnapshot(
  ctx: OrgContext,
  sessionId: string,
  input: {
    url?: string;
    pageTitle?: string;
    visibleTextSummary?: string;
    semanticElements?: unknown;
  },
) {
  requirePermission(ctx.membership.role, "computer:operate");
  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) throw new Error("Computer session not found");
  if (!OPEN_SESSION_STATUSES.includes(session.status)) {
    throw new Error(`A snapshot cannot be recorded on a ${session.status} session`);
  }

  const semantic =
    input.semanticElements === undefined
      ? null
      : computerSemanticSchema.parse(input.semanticElements);

  const snapshot = await prisma.computerSnapshot.create({
    data: {
      organisationId: ctx.organisation.id,
      sessionId: session.id,
      recordedByMembershipId: ctx.membership.id,
      url: optionalTrimmed(input.url, COMPUTER_LIMITS.snapshotUrl, "URL"),
      pageTitle: optionalTrimmed(
        input.pageTitle,
        COMPUTER_LIMITS.snapshotTitle,
        "Page title",
      ),
      visibleTextSummary: optionalTrimmed(
        input.visibleTextSummary,
        COMPUTER_LIMITS.snapshotText,
        "Visible text summary",
      ),
      semanticJson:
        semantic === null ? Prisma.DbNull : (semantic as Prisma.InputJsonValue),
    },
  });
  // Ids only — never url, title, text or elements. Snapshot content is
  // untrusted and stays in governed domain storage.
  await audit(ctx, {
    eventType: "computer.snapshot.recorded",
    targetType: "ComputerSnapshot",
    targetId: snapshot.id,
    after: { sessionId: session.id },
  });
  return snapshot;
}

/* ── Actions ────────────────────────────────────────────────────────── */

export async function proposeComputerAction(
  ctx: OrgContext,
  sessionId: string,
  input: {
    actionType: ComputerActionType;
    riskTier: ComputerRiskTier;
    reason: string;
    stepId?: string;
    target?: unknown;
    confidence?: number;
    beforeSnapshotId?: string;
    aiActionId?: string;
  },
): Promise<ComputerAction> {
  requirePermission(ctx.membership.role, "computer:operate");
  const reason = trimmed(input.reason, COMPUTER_LIMITS.actionReason, "Reason");

  if (!meetsRiskFloor(input.actionType, input.riskTier)) {
    throw new Error(
      `${input.riskTier} is below the minimum risk tier for ${input.actionType} — risk floors cannot be undercut`,
    );
  }
  if (input.confidence !== undefined && !isValidConfidence(input.confidence)) {
    throw new Error("Confidence must be between 0 and 1");
  }
  const target =
    input.target === undefined ? null : computerTargetSchema.parse(input.target);

  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    select: { id: true, status: true, conversationId: true },
  });
  if (!session) throw new Error("Computer session not found");
  if (!ACTION_PROPOSABLE_SESSION_STATUSES.includes(session.status)) {
    throw new Error(`An action cannot be proposed for a ${session.status} session`);
  }

  if (input.stepId) {
    const step = await prisma.computerStep.findFirst({
      where: {
        ...scope(ctx),
        id: input.stepId,
        plan: { sessionId: session.id, status: "PROPOSED" },
      },
      select: { id: true },
    });
    if (!step) throw new Error("Step not found on the session's current plan");
  }
  if (input.beforeSnapshotId) {
    const snapshot = await prisma.computerSnapshot.findFirst({
      where: { ...scope(ctx), id: input.beforeSnapshotId, sessionId: session.id },
      select: { id: true },
    });
    if (!snapshot) throw new Error("Before-snapshot not found on this session");
  }
  if (input.aiActionId) {
    const aiAction = await prisma.aIAction.findFirst({
      where: { ...scope(ctx), id: input.aiActionId },
      select: { id: true },
    });
    if (!aiAction) throw new Error("AI action not found");
  }

  const status = initialActionStatusFor(input.riskTier);
  const lowConfidence = isLowConfidence(input.confidence ?? null);

  const { action, approvalRequestId } = await prisma.$transaction(async (tx) => {
    const action = await tx.computerAction.create({
      data: {
        organisationId: ctx.organisation.id,
        sessionId: session.id,
        stepId: input.stepId ?? null,
        actionType: input.actionType,
        riskTier: input.riskTier,
        status,
        reason,
        targetJson:
          target === null ? Prisma.DbNull : (target as Prisma.InputJsonValue),
        confidence: input.confidence ?? null,
        proposedByMembershipId: ctx.membership.id,
        aiActionId: input.aiActionId ?? null,
        beforeSnapshotId: input.beforeSnapshotId ?? null,
      },
    });
    let approvalRequestId: string | null = null;
    if (requiresApproval(input.riskTier)) {
      // The unified gate — same model, same decision service, same
      // approvals:decide authority as AI reply drafts. Idempotent per
      // action via the (organisationId, sourceType, sourceId) unique.
      const approval = await tx.approvalRequest.create({
        data: {
          organisationId: ctx.organisation.id,
          conversationId: session.conversationId,
          sourceType: "COMPUTER_ACTION",
          sourceId: action.id,
          actionType: computerApprovalActionType(input.actionType),
          requestedByMembershipId: ctx.membership.id,
          originalPayload: {
            actionType: input.actionType,
            riskTier: input.riskTier,
            reason,
            target: target as Prisma.InputJsonValue | null,
            confidence: input.confidence ?? null,
          } as Prisma.InputJsonValue,
          riskLevel: approvalRiskLevelFor(input.riskTier),
          lowConfidence,
          idempotencyKey: action.id,
        },
      });
      approvalRequestId = approval.id;
    }
    return { action, approvalRequestId };
  });

  await audit(ctx, {
    eventType: "computer.action.proposed",
    targetType: "ComputerAction",
    targetId: action.id,
    after: {
      sessionId: session.id,
      actionType: action.actionType,
      riskTier: action.riskTier,
      status: action.status,
      confidence: action.confidence,
      aiActionId: action.aiActionId,
    },
  });
  if (action.status === "BLOCKED") {
    // R4: recorded, never executable, no approval path. The final act is
    // the authorized human's, outside Computer.
    await audit(ctx, {
      eventType: "computer.action.blocked",
      targetType: "ComputerAction",
      targetId: action.id,
      after: { riskTier: action.riskTier },
    });
  }
  if (approvalRequestId) {
    await audit(ctx, {
      eventType: "computer.approval.requested",
      targetType: "ApprovalRequest",
      targetId: approvalRequestId,
      after: { computerActionId: action.id, riskTier: action.riskTier },
    });
  }
  return action;
}

export async function cancelComputerAction(
  ctx: OrgContext,
  actionId: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  const action = await prisma.computerAction.findFirst({
    where: { ...scope(ctx), id: actionId },
    select: { id: true, status: true },
  });
  if (!action) throw new Error("Computer action not found");

  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.computerAction.updateMany({
      where: {
        ...scope(ctx),
        id: action.id,
        status: { in: CANCELLABLE_ACTION_STATUSES },
      },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count === 0) {
      throw new Error(`A ${action.status} action cannot be cancelled`);
    }
    await tx.approvalRequest.updateMany({
      where: {
        ...scope(ctx),
        sourceType: "COMPUTER_ACTION",
        sourceId: action.id,
        status: "PENDING",
      },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
  });
  await audit(ctx, {
    eventType: "computer.action.cancelled",
    targetType: "ComputerAction",
    targetId: action.id,
    before: { status: action.status },
    after: { status: "CANCELLED" },
  });
}

/* ── Verification ───────────────────────────────────────────────────── */

export async function recordComputerVerification(
  ctx: OrgContext,
  actionId: string,
  input: {
    result: Exclude<ComputerVerificationResult, "NOT_RUN">;
    note?: string;
    afterSnapshotId?: string;
  },
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  if (!["VERIFIED", "FAILED", "INCONCLUSIVE"].includes(input.result)) {
    throw new Error("Verification result must be VERIFIED, FAILED or INCONCLUSIVE");
  }
  const note = optionalTrimmed(
    input.note,
    COMPUTER_LIMITS.verificationNote,
    "Verification note",
  );
  const action = await prisma.computerAction.findFirst({
    where: { ...scope(ctx), id: actionId },
    select: { id: true, status: true, sessionId: true, verificationResult: true },
  });
  if (!action) throw new Error("Computer action not found");
  if (input.afterSnapshotId) {
    const snapshot = await prisma.computerSnapshot.findFirst({
      where: { ...scope(ctx), id: input.afterSnapshotId, sessionId: action.sessionId },
      select: { id: true },
    });
    if (!snapshot) throw new Error("After-snapshot not found on this session");
  }

  // One-shot and status-gated in a single conditional update: never on
  // APPROVAL_PENDING (an unapproved R3 must not look executable), never on
  // BLOCKED/REJECTED/CANCELLED, never twice.
  const recorded = await prisma.computerAction.updateMany({
    where: {
      ...scope(ctx),
      id: action.id,
      status: { in: VERIFIABLE_ACTION_STATUSES },
      verificationResult: "NOT_RUN",
    },
    data: {
      verificationResult: input.result,
      verificationNote: note,
      afterSnapshotId: input.afterSnapshotId ?? null,
      verifiedAt: new Date(),
    },
  });
  if (recorded.count === 0) {
    throw new Error(
      "Verification can be recorded once, on an open proposal or an approved action",
    );
  }
  await audit(ctx, {
    eventType: "computer.verification.recorded",
    targetType: "ComputerAction",
    targetId: action.id,
    after: { result: input.result, afterSnapshotId: input.afterSnapshotId ?? null },
  });
}

/* ── Session conclusion ─────────────────────────────────────────────── */

export async function concludeComputerSession(
  ctx: OrgContext,
  sessionId: string,
  outcome: "COMPLETED" | "FAILED",
  note?: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  const outcomeNote = optionalTrimmed(note, COMPUTER_LIMITS.outcomeNote, "Outcome note");
  const pending = await prisma.computerAction.findFirst({
    where: { ...scope(ctx), sessionId, status: "APPROVAL_PENDING" },
    select: { id: true },
  });
  if (pending) {
    throw new Error(
      "The session has actions awaiting approval — decide or cancel them first",
    );
  }
  const moved = await prisma.computerSession.updateMany({
    where: { ...scope(ctx), id: sessionId, status: "READY" },
    data: { status: outcome, outcomeNote, concludedAt: new Date() },
  });
  if (moved.count === 0) throw new Error("Only a READY session can be concluded");
  // A closed session invalidates its bridge authorization (C2).
  await prisma.computerBridgeGrant.updateMany({
    where: {
      ...scope(ctx),
      sessionId,
      status: { in: ["PENDING", "ATTACHED"] },
    },
    data: { status: "REVOKED", detachedAt: new Date() },
  });
  await audit(ctx, {
    eventType: "computer.session.concluded",
    targetType: "ComputerSession",
    targetId: sessionId,
    after: { status: outcome },
  });
}

export async function cancelComputerSession(
  ctx: OrgContext,
  sessionId: string,
  note?: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  const outcomeNote = optionalTrimmed(note, COMPUTER_LIMITS.outcomeNote, "Outcome note");
  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) throw new Error("Computer session not found");

  await prisma.$transaction(async (tx) => {
    const moved = await tx.computerSession.updateMany({
      where: {
        ...scope(ctx),
        id: session.id,
        status: { in: OPEN_SESSION_STATUSES },
      },
      data: { status: "CANCELLED", outcomeNote, concludedAt: new Date() },
    });
    if (moved.count === 0) {
      throw new Error(`A ${session.status} session cannot be cancelled`);
    }
    const openActions = await tx.computerAction.findMany({
      where: {
        ...scope(ctx),
        sessionId: session.id,
        status: { in: CANCELLABLE_ACTION_STATUSES },
      },
      select: { id: true },
    });
    if (openActions.length > 0) {
      const ids = openActions.map((a) => a.id);
      await tx.computerAction.updateMany({
        where: { ...scope(ctx), id: { in: ids } },
        data: { status: "CANCELLED" },
      });
      await tx.approvalRequest.updateMany({
        where: {
          ...scope(ctx),
          sourceType: "COMPUTER_ACTION",
          sourceId: { in: ids },
          status: "PENDING",
        },
        data: { status: "CANCELLED", decidedAt: new Date() },
      });
    }
    // A cancelled session invalidates its bridge authorization (C2).
    await tx.computerBridgeGrant.updateMany({
      where: {
        ...scope(ctx),
        sessionId: session.id,
        status: { in: ["PENDING", "ATTACHED"] },
      },
      data: { status: "REVOKED", detachedAt: new Date() },
    });
  });
  await audit(ctx, {
    eventType: "computer.session.cancelled",
    targetType: "ComputerSession",
    targetId: session.id,
    before: { status: session.status },
    after: { status: "CANCELLED" },
  });
}

/* ── C2: browser bridge (read-only observation transport) ───────────── */

/**
 * The bridge is one-way observation. There is NO code path from Operanto
 * back into the user's page: no click, no type, no navigate, no submit —
 * those verbs do not exist anywhere in this module or the extension. The
 * pairing token is the only credential: 32 random bytes handed to the user
 * once, SHA-256 at rest, session-bound, hard-expiring, revoked when the
 * session closes. Operanto never sees the target site's credentials.
 */

const BRIDGE_TOKEN_TTL_MS = 60 * 60_000;

function hashBridgeToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export class BridgeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeAuthError";
  }
}

/**
 * Mint a pairing token for a session. The raw token appears ONLY in this
 * return value (for the user to paste into the extension) — it is never
 * stored, logged, or audited. One active grant per session: prior open
 * grants are revoked.
 */
export async function createComputerBridgeGrant(
  ctx: OrgContext,
  sessionId: string,
): Promise<{ grantId: string; token: string; expiresAt: Date }> {
  requirePermission(ctx.membership.role, "computer:operate");
  if (!computerBridgeEnabled()) {
    throw new Error("The Computer browser bridge is not enabled");
  }
  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) throw new Error("Computer session not found");
  if (!OPEN_SESSION_STATUSES.includes(session.status)) {
    throw new Error(`A bridge cannot attach to a ${session.status} session`);
  }

  const token = randomBytes(32).toString("base64url");
  const grant = await prisma.$transaction(async (tx) => {
    await tx.computerBridgeGrant.updateMany({
      where: {
        ...scope(ctx),
        sessionId: session.id,
        status: { in: ["PENDING", "ATTACHED"] },
      },
      data: { status: "REVOKED", detachedAt: new Date() },
    });
    return tx.computerBridgeGrant.create({
      data: {
        organisationId: ctx.organisation.id,
        sessionId: session.id,
        createdByMembershipId: ctx.membership.id,
        tokenHash: hashBridgeToken(token),
        expiresAt: new Date(Date.now() + BRIDGE_TOKEN_TTL_MS),
      },
    });
  });
  await audit(ctx, {
    eventType: "computer.bridge.granted",
    targetType: "ComputerBridgeGrant",
    targetId: grant.id,
    after: { sessionId: session.id, expiresAt: grant.expiresAt.toISOString() },
  });
  return { grantId: grant.id, token, expiresAt: grant.expiresAt };
}

/** Cockpit-side detach/revoke of a bridge grant. */
export async function detachComputerBridge(
  ctx: OrgContext,
  grantId: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  const detached = await prisma.computerBridgeGrant.updateMany({
    where: {
      ...scope(ctx),
      id: grantId,
      status: { in: ["PENDING", "ATTACHED"] },
    },
    data: { status: "DETACHED", detachedAt: new Date() },
  });
  if (detached.count === 0) throw new Error("No open bridge grant to detach");
  await audit(ctx, {
    eventType: "computer.bridge.detached",
    targetType: "ComputerBridgeGrant",
    targetId: grantId,
  });
}

type ResolvedGrant = NonNullable<
  Awaited<ReturnType<typeof resolveGrantByToken>>
>;

function resolveGrantByToken(rawToken: string) {
  return prisma.computerBridgeGrant.findUnique({
    where: { tokenHash: hashBridgeToken(rawToken) },
    include: {
      session: {
        select: {
          id: true,
          status: true,
          organisationId: true,
          customer: { select: { restrictedAt: true } },
        },
      },
    },
  });
}

function assertGrantUsable(grant: ResolvedGrant | null): asserts grant is ResolvedGrant {
  if (!grant) throw new BridgeAuthError("Unknown bridge token");
  if (grant.expiresAt.getTime() <= Date.now()) {
    throw new BridgeAuthError("The bridge authorization has expired");
  }
}

/**
 * Extension-side attach: first use of the pairing token. Atomic claim —
 * PENDING → ATTACHED exactly once, and only before expiry.
 */
export async function attachComputerBridgeByToken(
  rawToken: string,
): Promise<{ bridgeId: string; sessionId: string; expiresAt: Date }> {
  if (!computerBridgeEnabled()) {
    throw new BridgeAuthError("The Computer browser bridge is not enabled");
  }
  const grant = await resolveGrantByToken(rawToken);
  assertGrantUsable(grant);
  const claimed = await prisma.computerBridgeGrant.updateMany({
    where: { id: grant.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "ATTACHED", attachedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new BridgeAuthError("The bridge token was already used or revoked");
  }
  await auditSystem(grant.organisationId, "SYSTEM", {
    eventType: "computer.bridge.attached",
    targetType: "ComputerBridgeGrant",
    targetId: grant.id,
    after: { sessionId: grant.sessionId },
  });
  return {
    bridgeId: grant.id,
    sessionId: grant.sessionId,
    expiresAt: grant.expiresAt,
  };
}

/** Extension-side detach: observation stops immediately. */
export async function detachComputerBridgeByToken(
  rawToken: string,
): Promise<void> {
  if (!computerBridgeEnabled()) {
    throw new BridgeAuthError("The Computer browser bridge is not enabled");
  }
  const grant = await resolveGrantByToken(rawToken);
  if (!grant) throw new BridgeAuthError("Unknown bridge token");
  const detached = await prisma.computerBridgeGrant.updateMany({
    where: { id: grant.id, status: { in: ["PENDING", "ATTACHED"] } },
    data: { status: "DETACHED", detachedAt: new Date() },
  });
  if (detached.count > 0) {
    await auditSystem(grant.organisationId, "SYSTEM", {
      eventType: "computer.bridge.detached",
      targetType: "ComputerBridgeGrant",
      targetId: grant.id,
      after: { sessionId: grant.sessionId },
    });
  }
}

/**
 * Ingest one sanitized observation from an ATTACHED bridge. The payload is
 * treated as hostile until `sanitizeBrowserPayload` accepts it; what is
 * stored remains untrusted observation data. Replay-idempotent via the
 * (bridgeId, clientCaptureId) unique — a retried POST returns the original
 * snapshot instead of duplicating it.
 */
export async function recordBridgeSnapshot(
  rawToken: string,
  rawPayload: unknown,
): Promise<{ snapshotId: string; sessionId: string; duplicate: boolean }> {
  if (!computerBridgeEnabled()) {
    throw new BridgeAuthError("The Computer browser bridge is not enabled");
  }
  const grant = await resolveGrantByToken(rawToken);
  assertGrantUsable(grant);
  if (grant.status !== "ATTACHED") {
    throw new BridgeAuthError("The bridge is not attached");
  }
  if (!OPEN_SESSION_STATUSES.includes(grant.session.status)) {
    throw new BridgeAuthError("The session is no longer open for observation");
  }
  if (grant.session.customer?.restrictedAt) {
    // Art. 18: restriction halts observation exactly like other processing.
    throw new BridgeAuthError(
      "Processing for this customer is restricted — observation is paused",
    );
  }

  const payload = sanitizeBrowserPayload(rawPayload);
  try {
    const snapshot = await prisma.computerSnapshot.create({
      data: {
        organisationId: grant.organisationId,
        sessionId: grant.sessionId,
        recordedByMembershipId: grant.createdByMembershipId,
        bridgeId: grant.id,
        clientCaptureId: payload.captureId,
        url: payload.url,
        pageTitle: payload.pageTitle,
        visibleTextSummary: payload.visibleTextSummary,
        semanticJson:
          payload.elements === null
            ? Prisma.DbNull
            : (payload.elements as unknown as Prisma.InputJsonValue),
      },
    });
    await prisma.computerBridgeGrant.update({
      where: { id: grant.id },
      data: { lastCaptureAt: new Date(), captureCount: { increment: 1 } },
    });
    // Ids only — the page's url/title/text/elements stay in domain storage.
    await auditSystem(grant.organisationId, "SYSTEM", {
      eventType: "computer.snapshot.recorded",
      targetType: "ComputerSnapshot",
      targetId: snapshot.id,
      after: {
        sessionId: grant.sessionId,
        bridgeId: grant.id,
        elementCount: payload.elements?.length ?? 0,
      },
    });
    return { snapshotId: snapshot.id, sessionId: grant.sessionId, duplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      payload.captureId
    ) {
      const existing = await prisma.computerSnapshot.findFirst({
        where: { bridgeId: grant.id, clientCaptureId: payload.captureId },
        select: { id: true },
      });
      if (existing) {
        return {
          snapshotId: existing.id,
          sessionId: grant.sessionId,
          duplicate: true,
        };
      }
    }
    throw error;
  }
}

export { BrowserPayloadError };
