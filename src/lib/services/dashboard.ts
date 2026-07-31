import "server-only";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { opportunityAccessWhere } from "@/lib/services/opportunities";

export async function getDashboard(ctx: OrgContext) {
  const accessWhere = opportunityAccessWhere(ctx);
  const isManager = can(ctx.membership.role, "opportunities:view_all");
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [
    newOpportunities,
    unassignedOpportunities,
    followUpsDue,
    myOpenTasks,
    myOpportunities,
    recentActivity,
    stageCounts,
    failedEvents,
    integration,
  ] = await Promise.all([
    prisma.opportunity.count({
      where: { ...accessWhere, stage: "NEW", createdAt: { gte: sevenDaysAgo } },
    }),
    isManager
      ? prisma.opportunity.count({
          where: {
            ...scope(ctx),
            assignedMembershipId: null,
            stage: { notIn: ["WON", "LOST", "CLOSED"] },
          },
        })
      : Promise.resolve(0),
    prisma.task.count({
      where: {
        ...scope(ctx),
        status: "OPEN",
        dueAt: { lte: now },
        ...(isManager ? {} : { assignedMembershipId: ctx.membership.id }),
      },
    }),
    prisma.task.findMany({
      where: {
        ...scope(ctx),
        status: "OPEN",
        assignedMembershipId: ctx.membership.id,
      },
      orderBy: [{ dueAt: "asc" }],
      take: 8,
      include: {
        opportunity: {
          select: { id: true, summary: true, customer: { select: { name: true } } },
        },
      },
    }),
    prisma.opportunity.findMany({
      where: { ...accessWhere, stage: { notIn: ["WON", "LOST", "CLOSED"] } },
      orderBy: [{ lastActivityAt: "desc" }],
      take: 8,
      include: {
        customer: { select: { id: true, name: true } },
        properties: { include: { propertyContext: { select: { referenceCode: true } } } },
      },
    }),
    prisma.activity.findMany({
      where: isManager
        ? scope(ctx)
        : { ...scope(ctx), opportunity: { assignedMembershipId: ctx.membership.id } },
      orderBy: { occurredAt: "desc" },
      take: 10,
      include: {
        customer: { select: { id: true, name: true } },
        opportunity: { select: { id: true } },
      },
    }),
    prisma.opportunity.groupBy({
      by: ["stage"],
      where: accessWhere,
      _count: { _all: true },
    }),
    isManager
      ? prisma.inboundEvent.count({
          where: {
            ...scope(ctx),
            processingStatus: { in: ["FAILED", "DEAD_LETTER"] },
          },
        })
      : Promise.resolve(0),
    can(ctx.membership.role, "integrations:manage")
      ? prisma.integration.findFirst({
          where: { ...scope(ctx), type: "PRONATONA" },
          select: {
            status: true,
            lastReceivedAt: true,
            lastSuccessfulAt: true,
            lastErrorAt: true,
          },
        })
      : Promise.resolve(null),
  ]);

  return {
    newOpportunities,
    unassignedOpportunities,
    followUpsDue,
    myOpenTasks,
    myOpportunities,
    recentActivity,
    stageCounts: Object.fromEntries(
      stageCounts.map((row) => [row.stage, row._count._all]),
    ),
    failedEvents,
    integration,
    isManager,
  };
}
