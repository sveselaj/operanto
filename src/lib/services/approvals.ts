import "server-only";
import type { ApprovalRequest, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { canApproveDraft } from "@/lib/ai/policy";
import { addManualMessage, conversationAccessWhere } from "@/lib/services/conversations";

/**
 * Unified approval gate (Slice 4: AI reply drafts; later slices reuse it for
 * business actions).
 *
 * Decisions are atomic conditional updates — two concurrent reviewers cannot
 * both win, and a decided request can never be re-decided. Approval admits a
 * draft into the MANUAL message flow via an explicit, separately-claimed
 * execution step; nothing is ever sent externally.
 */

const MAX_REPLY_LENGTH = 2000;

export async function listPendingApprovals(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "approvals:read");
  return prisma.approvalRequest.findMany({
    where: { ...scope(ctx), status: "PENDING" },
    orderBy: { requestedAt: "desc" },
    take: 50,
    include: {
      requestedBy: { include: { user: { select: { name: true } } } },
    },
  });
}

/** The latest reply-draft approval for a conversation the caller can access. */
export async function getConversationApproval(
  ctx: OrgContext,
  conversationId: string,
): Promise<ApprovalRequest | null> {
  requirePermission(ctx.membership.role, "ai:read");
  const conversation = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
    select: { id: true },
  });
  if (!conversation) return null;
  return prisma.approvalRequest.findFirst({
    where: { ...scope(ctx), conversationId, sourceType: "AI_REPLY_DRAFT" },
    orderBy: { requestedAt: "desc" },
  });
}

/** Edit-before-approve: replace the draft text while the gate is PENDING. */
export async function editApprovalDraft(
  ctx: OrgContext,
  approvalId: string,
  reply: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "approvals:decide");
  const trimmed = reply.trim();
  if (!trimmed || trimmed.length > MAX_REPLY_LENGTH) {
    throw new Error(`Draft must be 1–${MAX_REPLY_LENGTH} characters`);
  }
  // Only reply drafts are editable. A Computer action proposal is decided
  // as proposed or rejected — rewriting a typed action at the approval
  // gate would approve something nobody proposed.
  const updated = await prisma.approvalRequest.updateMany({
    where: {
      ...scope(ctx),
      id: approvalId,
      status: "PENDING",
      sourceType: "AI_REPLY_DRAFT",
    },
    data: { editedPayload: { reply: trimmed } as Prisma.InputJsonValue },
  });
  if (updated.count === 0) throw new Error("Approval request is no longer pending");
  await audit(ctx, {
    eventType: "ai.draft.edited",
    targetType: "ApprovalRequest",
    targetId: approvalId,
  });
}

export async function decideApproval(
  ctx: OrgContext,
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  options: { reason?: string; acknowledgeLowConfidence?: boolean } = {},
): Promise<ApprovalRequest> {
  requirePermission(ctx.membership.role, "approvals:decide");
  const existing = await prisma.approvalRequest.findFirst({
    where: { ...scope(ctx), id: approvalId },
  });
  if (!existing) throw new Error("Approval request not found");
  if (existing.status !== "PENDING") {
    throw new Error("This request has already been decided");
  }

  if (decision === "APPROVED") {
    // Server-side policy — the UI checkbox is presentation, this is control.
    const verdict = canApproveDraft({
      riskLevel: existing.riskLevel,
      lowConfidence: existing.lowConfidence,
      acknowledgeLowConfidence: options.acknowledgeLowConfidence ?? false,
    });
    if (!verdict.allowed) throw new Error(verdict.reason);
  }

  // Atomic claim: only one decision ever lands.
  const claimed = await prisma.approvalRequest.updateMany({
    where: { ...scope(ctx), id: approvalId, status: "PENDING" },
    data: {
      status: decision,
      decidedByMembershipId: ctx.membership.id,
      decisionReason: options.reason?.trim().slice(0, 500) || null,
      decidedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new Error("This request has already been decided");
  }

  // Mirror the decision onto the source record — per source type, through
  // the same claimed gate. Computer actions may only leave APPROVAL_PENDING
  // through this decision (or cancellation), so the mirror is conditional.
  if (existing.sourceType === "AI_REPLY_DRAFT") {
    await prisma.aIAction.updateMany({
      where: { ...scope(ctx), id: existing.sourceId },
      data: { status: decision },
    });
  } else if (existing.sourceType === "COMPUTER_ACTION") {
    await prisma.computerAction.updateMany({
      where: { ...scope(ctx), id: existing.sourceId, status: "APPROVAL_PENDING" },
      data: { status: decision, decidedAt: new Date() },
    });
  }

  if (existing.conversationId) {
    const isComputer = existing.sourceType === "COMPUTER_ACTION";
    await prisma.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.conversationId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: isComputer
          ? decision === "APPROVED"
            ? "computer.action.approved"
            : "computer.action.rejected"
          : decision === "APPROVED"
            ? "ai.draft.approved"
            : "ai.draft.rejected",
        summary: isComputer
          ? decision === "APPROVED"
            ? "Computer action approved"
            : "Computer action rejected"
          : decision === "APPROVED"
            ? "AI reply draft approved for manual use"
            : "AI reply draft rejected",
        metadata: isComputer
          ? { approvalRequestId: existing.id, computerActionId: existing.sourceId }
          : { approvalRequestId: existing.id, aiActionId: existing.sourceId },
      },
    });
  }
  await audit(ctx, {
    eventType: "approval.decided",
    targetType: "ApprovalRequest",
    targetId: existing.id,
    before: { status: "PENDING" },
    after: {
      status: decision,
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      riskLevel: existing.riskLevel,
      lowConfidence: existing.lowConfidence,
      lowConfidenceAcknowledged: options.acknowledgeLowConfidence ?? false,
    },
  });
  if (existing.sourceType === "COMPUTER_ACTION") {
    await audit(ctx, {
      eventType:
        decision === "APPROVED"
          ? "computer.action.approved"
          : "computer.action.rejected",
      targetType: "ComputerAction",
      targetId: existing.sourceId,
      after: { approvalRequestId: existing.id, conversationId: existing.conversationId },
    });
  } else {
    await audit(ctx, {
      eventType: decision === "APPROVED" ? "ai.draft.approved" : "ai.draft.rejected",
      targetType: "AIAction",
      targetId: existing.sourceId,
      after: { approvalRequestId: existing.id, conversationId: existing.conversationId },
    });
  }

  return prisma.approvalRequest.findFirstOrThrow({
    where: { ...scope(ctx), id: approvalId },
  });
}

/**
 * Record an APPROVED draft as a manual Operanto message. Explicit second
 * step with its own atomic execution claim — approval alone changes nothing
 * in the conversation, and double-execution is impossible.
 */
export async function applyApprovedDraft(
  ctx: OrgContext,
  approvalId: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "conversations:message");
  // sourceType-guarded: an approved COMPUTER_ACTION is not a draft and must
  // never be recordable as a conversation message.
  const existing = await prisma.approvalRequest.findFirst({
    where: {
      ...scope(ctx),
      id: approvalId,
      status: "APPROVED",
      sourceType: "AI_REPLY_DRAFT",
    },
  });
  if (!existing || !existing.conversationId) {
    throw new Error("No approved draft to apply");
  }

  const claimed = await prisma.approvalRequest.updateMany({
    where: { ...scope(ctx), id: approvalId, status: "APPROVED", executionClaimedAt: null },
    data: { executionClaimedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new Error("This draft was already used");
  }

  const payload = (existing.editedPayload ?? existing.originalPayload) as {
    reply?: string;
  };
  if (!payload.reply) throw new Error("The draft has no content");

  // The manual message path re-checks restriction and record scope itself.
  await addManualMessage(ctx, existing.conversationId, payload.reply);
}
