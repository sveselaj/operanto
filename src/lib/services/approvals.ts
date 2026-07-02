import "server-only";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";

/**
 * Read side of the approval queue. Decisions (approve/reject/edit) live in the
 * tool runtime (`src/lib/tools/runtime.ts`) so execution stays in one place.
 */
export async function listApprovals(
  ctx: WorkspaceContext,
  status: ApprovalStatus | "all" = "pending",
) {
  requirePermission(ctx.member.role, "approvals:review");
  return prisma.approvalRequest.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      ...(status === "all" ? {} : { status }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      toolInvocation: true,
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
}

export async function countPendingApprovals(ctx: WorkspaceContext): Promise<number> {
  if (!ctx) return 0;
  return prisma.approvalRequest.count({
    where: { workspaceId: ctx.workspace.id, status: "pending" },
  });
}

/** Expire stale pending approvals (past `expiresAt`). Safe to call opportunistically. */
export async function expireStaleApprovals(ctx: WorkspaceContext): Promise<number> {
  const now = new Date();
  const stale = await prisma.approvalRequest.findMany({
    where: { workspaceId: ctx.workspace.id, status: "pending", expiresAt: { lt: now } },
    select: { id: true, toolInvocationId: true },
  });
  if (stale.length === 0) return 0;
  await prisma.approvalRequest.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { status: "expired", reviewedAt: now },
  });
  await prisma.toolInvocation.updateMany({
    where: { id: { in: stale.map((s) => s.toolInvocationId) }, status: "awaiting_approval" },
    data: { status: "cancelled", completedAt: now },
  });
  return stale.length;
}
