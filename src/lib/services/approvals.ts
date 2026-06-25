import "server-only";
import type { ApprovalRequest, ApprovalStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission, can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { applyApprovalEffect } from "./approval-effects";

/**
 * Approvals — a generic human-approval gate. Any service can `requestApproval`
 * for a sensitive action (quote.send, price.override, …); a user with
 * `approvals:decide` approves or rejects, and approval applies the side effect.
 */

export type RequestApprovalInput = {
  entityType: string;
  entityId: string;
  action: string;
  reason?: string | null;
  payload?: unknown;
};

/**
 * Create a pending approval (idempotent per entity+action). Called by other
 * services that have already authorized the request itself.
 */
export async function requestApproval(
  ctx: WorkspaceContext,
  input: RequestApprovalInput,
): Promise<ApprovalRequest> {
  const existing = await prisma.approvalRequest.findFirst({
    where: {
      workspaceId: ctx.workspace.id,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      status: "pending",
    },
  });
  if (existing) return existing;

  const ar = await prisma.approvalRequest.create({
    data: {
      workspaceId: ctx.workspace.id,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      status: "pending",
      requestedByUserId: ctx.userId,
      reason: input.reason ?? null,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  await audit(ctx, {
    action: "approval.request",
    entity: "ApprovalRequest",
    entityId: ar.id,
    after: { action: input.action, entityType: input.entityType, entityId: input.entityId },
  });
  return ar;
}

/** Pending approval for a specific entity+action, if any (for UI gating). */
export function pendingApproval(ctx: WorkspaceContext, entityType: string, entityId: string, action: string) {
  return prisma.approvalRequest.findFirst({
    where: { workspaceId: ctx.workspace.id, entityType, entityId, action, status: "pending" },
  });
}

/**
 * List approvals. Deciders see everything; everyone else sees only the requests
 * they filed.
 */
export function listApprovals(ctx: WorkspaceContext, filters: { status?: ApprovalStatus | "all" } = {}) {
  const where: Prisma.ApprovalRequestWhereInput = { workspaceId: ctx.workspace.id };
  if (filters.status && filters.status !== "all") where.status = filters.status;
  if (!can(ctx.member.role, "approvals:decide")) where.requestedByUserId = ctx.userId;
  return prisma.approvalRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
}

export function pendingApprovalCount(ctx: WorkspaceContext) {
  if (!can(ctx.member.role, "approvals:decide")) return Promise.resolve(0);
  return prisma.approvalRequest.count({
    where: { workspaceId: ctx.workspace.id, status: "pending" },
  });
}

async function assertApproval(ctx: WorkspaceContext, id: string) {
  const ar = await prisma.approvalRequest.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!ar) throw new Error("Approval request not found");
  return ar;
}

/** Approve or reject — approving applies the gated side effect. */
export async function decideApproval(
  ctx: WorkspaceContext,
  id: string,
  decision: "approved" | "rejected",
  note?: string,
) {
  requirePermission(ctx.member.role, "approvals:decide");
  const ar = await assertApproval(ctx, id);
  if (ar.status !== "pending") throw new Error("This request has already been decided");

  await prisma.approvalRequest.update({
    where: { id },
    data: {
      status: decision,
      decidedByUserId: ctx.userId,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    },
  });

  if (decision === "approved") {
    await applyApprovalEffect(ctx.workspace.id, {
      action: ar.action,
      entityId: ar.entityId,
      payload: ar.payload,
    });
  }
  await audit(ctx, {
    action: "approval.decide",
    entity: "ApprovalRequest",
    entityId: id,
    after: { decision, action: ar.action },
  });
}

/** Cancel a pending request (requester or a decider). */
export async function cancelApproval(ctx: WorkspaceContext, id: string) {
  const ar = await assertApproval(ctx, id);
  const isOwner = ar.requestedByUserId === ctx.userId;
  if (!isOwner && !can(ctx.member.role, "approvals:decide")) {
    throw new Error("Only the requester or an approver can cancel this");
  }
  if (ar.status !== "pending") throw new Error("Only pending requests can be cancelled");
  await prisma.approvalRequest.update({ where: { id }, data: { status: "cancelled" } });
  await audit(ctx, { action: "approval.cancel", entity: "ApprovalRequest", entityId: id });
}
