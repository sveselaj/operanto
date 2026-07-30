import "server-only";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";

export async function listActivity(ctx: OrgContext, limit = 100) {
  requirePermission(ctx.membership.role, "opportunities:view_assigned");
  const where = can(ctx.membership.role, "activity:view_all")
    ? scope(ctx)
    : { ...scope(ctx), opportunity: { assignedMembershipId: ctx.membership.id } };
  return prisma.activity.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: {
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, summary: true } },
    },
  });
}

export async function listAuditEvents(
  ctx: OrgContext,
  filter: { targetType?: string } = {},
  limit = 150,
) {
  requirePermission(ctx.membership.role, "audit:view");
  return prisma.auditEvent.findMany({
    where: {
      ...scope(ctx),
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
