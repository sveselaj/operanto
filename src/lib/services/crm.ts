import "server-only";
import type { OpportunityStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";

export async function listOpportunities(
  ctx: WorkspaceContext,
  filters: { stage?: OpportunityStage } = {},
) {
  requirePermission(ctx.member.role, "opportunities:read");
  return prisma.opportunity.findMany({
    where: { workspaceId: ctx.workspace.id, ...(filters.stage ? { stage: filters.stage } : {}) },
    include: {
      contact: { select: { name: true, location: true } },
      owner: { select: { name: true } },
    },
    orderBy: [{ leadScore: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
}

export const OPPORTUNITY_STAGES: OpportunityStage[] = [
  "new",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];
