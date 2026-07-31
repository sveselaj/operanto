import "server-only";
import type { OpportunityStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";

/**
 * Opportunity reads/writes. Every function takes the resolved OrgContext and
 * applies BOTH the org scope and (for operators) the record-level assignment
 * filter. Direct IDs from the URL can never cross either boundary.
 */

export const OPPORTUNITY_STAGES: OpportunityStage[] = [
  "NEW",
  "CONTACT_REQUIRED",
  "QUALIFYING",
  "VIEWING_REQUESTED",
  "VIEWING_SCHEDULED",
  "OFFER",
  "WON",
  "LOST",
  "CLOSED",
];

/** Org + assignment scope for the caller. */
export function opportunityAccessWhere(ctx: OrgContext): Prisma.OpportunityWhereInput {
  if (can(ctx.membership.role, "opportunities:view_all")) return scope(ctx);
  return { ...scope(ctx), assignedMembershipId: ctx.membership.id };
}

const listInclude = {
  customer: { select: { id: true, name: true, email: true } },
  assignee: { include: { user: { select: { name: true } } } },
  properties: { include: { propertyContext: true } },
} satisfies Prisma.OpportunityInclude;

export async function listOpportunities(
  ctx: OrgContext,
  filters: { stage?: OpportunityStage; unassigned?: boolean } = {},
) {
  requirePermission(ctx.membership.role, "opportunities:view_assigned");
  return prisma.opportunity.findMany({
    where: {
      ...opportunityAccessWhere(ctx),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.unassigned ? { assignedMembershipId: null } : {}),
    },
    include: listInclude,
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getOpportunity(ctx: OrgContext, id: string) {
  requirePermission(ctx.membership.role, "opportunities:view_assigned");
  return prisma.opportunity.findFirst({
    where: { ...opportunityAccessWhere(ctx), id },
    include: {
      customer: true,
      assignee: { include: { user: { select: { name: true, email: true } } } },
      properties: { include: { propertyContext: true } },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }] },
      activities: { orderBy: { occurredAt: "desc" }, take: 100 },
    },
  });
}

export async function updateOpportunityStage(
  ctx: OrgContext,
  id: string,
  stage: OpportunityStage,
) {
  requirePermission(ctx.membership.role, "opportunities:update_stage");
  const existing = await prisma.opportunity.findFirst({
    where: { ...opportunityAccessWhere(ctx), id },
  });
  if (!existing) throw new Error("Opportunity not found");
  if (existing.stage === stage) return existing;

  const updated = await prisma.opportunity.update({
    where: { id: existing.id },
    data: { stage, lastActivityAt: new Date() },
  });
  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      opportunityId: existing.id,
      customerId: existing.customerId,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      activityType: "stage.changed",
      summary: `Stage changed from ${existing.stage} to ${stage}`,
      metadata: { fromStage: existing.stage, toStage: stage },
    },
  });
  await audit(ctx, {
    eventType: "opportunity.stage_changed",
    targetType: "Opportunity",
    targetId: existing.id,
    before: { stage: existing.stage },
    after: { stage },
  });
  return updated;
}

export async function assignOpportunity(
  ctx: OrgContext,
  id: string,
  membershipId: string | null,
) {
  requirePermission(ctx.membership.role, "opportunities:assign");
  const existing = await prisma.opportunity.findFirst({
    where: { ...scope(ctx), id },
  });
  if (!existing) throw new Error("Opportunity not found");

  if (membershipId) {
    const target = await prisma.membership.findFirst({
      where: { id: membershipId, ...scope(ctx), status: "ACTIVE" },
    });
    if (!target) throw new Error("Assignee is not an active member of this organisation");
  }

  const updated = await prisma.opportunity.update({
    where: { id: existing.id },
    data: { assignedMembershipId: membershipId, lastActivityAt: new Date() },
  });
  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      opportunityId: existing.id,
      customerId: existing.customerId,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      activityType: "assignment.changed",
      summary: membershipId ? "Opportunity reassigned" : "Opportunity unassigned",
      metadata: {
        fromMembershipId: existing.assignedMembershipId,
        toMembershipId: membershipId,
      },
    },
  });
  await audit(ctx, {
    eventType: "opportunity.assigned",
    targetType: "Opportunity",
    targetId: existing.id,
    before: { assignedMembershipId: existing.assignedMembershipId },
    after: { assignedMembershipId: membershipId },
  });
  return updated;
}

export async function addOpportunityNote(ctx: OrgContext, id: string, body: string) {
  requirePermission(ctx.membership.role, "notes:add");
  const existing = await prisma.opportunity.findFirst({
    where: { ...opportunityAccessWhere(ctx), id },
  });
  if (!existing) throw new Error("Opportunity not found");
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 5000) throw new Error("Note must be 1–5000 characters");

  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      opportunityId: existing.id,
      customerId: existing.customerId,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      activityType: "note.added",
      summary: trimmed,
    },
  });
  await prisma.opportunity.update({
    where: { id: existing.id },
    data: { lastActivityAt: new Date() },
  });
  await audit(ctx, {
    eventType: "opportunity.note_added",
    targetType: "Opportunity",
    targetId: existing.id,
  });
}

/** Members assignable to opportunities/tasks in this organisation. */
export async function listAssignableMembers(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "opportunities:view_assigned");
  return prisma.membership.findMany({
    where: { ...scope(ctx), status: "ACTIVE" },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}
