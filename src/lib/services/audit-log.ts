import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";

export async function listAuditEvents(
  ctx: WorkspaceContext,
  filters: { entity?: string; limit?: number } = {},
) {
  requirePermission(ctx.member.role, "reports:view");
  return prisma.auditLog.findMany({
    where: { workspaceId: ctx.workspace.id, ...(filters.entity ? { entity: filters.entity } : {}) },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 150,
  });
}
