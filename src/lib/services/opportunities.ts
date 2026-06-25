import "server-only";
import type { OpportunityStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";

/**
 * Lead Engine — Opportunity + CustomerRequirement service.
 *
 * An Opportunity is the commercial object that a conversation gets promoted to.
 * Requirements are the structured facts collected from the conversation; the
 * AI fills them (see ai-opportunities.ts) and agents can edit them.
 */

export type OpportunityFilters = {
  status?: OpportunityStatus | "all";
  assignee?: string | "me" | "unassigned" | "all";
  q?: string;
};

export async function listOpportunities(ctx: WorkspaceContext, filters: OpportunityFilters = {}) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const where: Prisma.OpportunityWhereInput = { workspaceId: ctx.workspace.id };

  if (filters.status && filters.status !== "all") where.status = filters.status;
  if (filters.assignee === "me") where.assignedToUserId = ctx.userId;
  else if (filters.assignee === "unassigned") where.assignedToUserId = null;
  else if (filters.assignee && filters.assignee !== "all") where.assignedToUserId = filters.assignee;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return prisma.opportunity.findMany({
    where,
    include: {
      customer: true,
      assignedTo: true,
      requirements: { select: { label: true, status: true, required: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
}

export async function opportunityStatusCounts(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const grouped = await prisma.opportunity.groupBy({
    by: ["status"],
    where: { workspaceId: ctx.workspace.id },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    total += g._count._all;
  }
  counts.all = total;
  return counts;
}

export async function getOpportunity(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "opportunities:manage");
  return prisma.opportunity.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: {
      customer: true,
      assignedTo: true,
      requirements: { orderBy: [{ required: "desc" }, { createdAt: "asc" }] },
      conversations: {
        select: { id: true, subject: true, channelType: true, status: true, lastMessageAt: true },
        orderBy: { lastMessageAt: "desc" },
      },
    },
  });
}

async function assertOpportunity(ctx: WorkspaceContext, id: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true, status: true, assignedToUserId: true, value: true, title: true },
  });
  if (!opp) throw new Error("Opportunity not found");
  return opp;
}

export async function createOpportunity(
  ctx: WorkspaceContext,
  input: { customerId: string; title?: string | null; source?: string | null; primaryConversationId?: string | null },
) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, workspaceId: ctx.workspace.id },
    select: { id: true, name: true },
  });
  if (!customer) throw new Error("Customer not found");

  const opp = await prisma.opportunity.create({
    data: {
      workspaceId: ctx.workspace.id,
      customerId: customer.id,
      title: input.title?.trim() || `${customer.name ?? "Customer"} — new opportunity`,
      currency: ctx.workspace.defaultCurrency,
      source: input.source ?? null,
      primaryConversationId: input.primaryConversationId ?? null,
      assignedToUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "opportunity.create", entity: "Opportunity", entityId: opp.id });
  return opp;
}

/**
 * Promote a conversation to an Opportunity (idempotent). Returns the existing
 * opportunity id if the conversation is already linked.
 */
export async function promoteConversation(ctx: WorkspaceContext, conversationId: string) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspace.id },
    select: { id: true, customerId: true, subject: true, opportunityId: true },
  });
  if (!conv) throw new Error("Conversation not found");
  if (conv.opportunityId) return { opportunityId: conv.opportunityId, created: false };
  if (!conv.customerId) throw new Error("Link a customer to this conversation first");

  const opp = await createOpportunity(ctx, {
    customerId: conv.customerId,
    title: conv.subject ?? null,
    source: "conversation",
    primaryConversationId: conv.id,
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { opportunityId: opp.id },
  });
  await audit(ctx, {
    action: "opportunity.promote",
    entity: "Opportunity",
    entityId: opp.id,
    after: { conversationId: conv.id },
  });
  return { opportunityId: opp.id, created: true };
}

export async function updateOpportunity(
  ctx: WorkspaceContext,
  id: string,
  patch: { status?: OpportunityStatus; stage?: string | null; title?: string; value?: number | null; closedReason?: string | null },
) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const before = await assertOpportunity(ctx, id);

  const data: Prisma.OpportunityUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.stage !== undefined) data.stage = patch.stage;
  if (patch.value !== undefined) data.value = patch.value;
  if (patch.closedReason !== undefined) data.closedReason = patch.closedReason;
  if (patch.status !== undefined) {
    data.status = patch.status;
    data.wonAt = patch.status === "won" ? new Date() : null;
    data.lostAt = patch.status === "lost" ? new Date() : null;
  }

  await prisma.opportunity.update({ where: { id }, data });
  await audit(ctx, {
    action: "opportunity.update",
    entity: "Opportunity",
    entityId: id,
    before: { status: before.status, value: before.value },
    after: patch,
  });
}

export async function assignOpportunity(ctx: WorkspaceContext, id: string, userId: string | null) {
  requirePermission(ctx.member.role, "opportunities:manage");
  await assertOpportunity(ctx, id);
  if (userId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId } },
    });
    if (!member) throw new Error("Assignee is not a member of this workspace");
  }
  await prisma.opportunity.update({ where: { id }, data: { assignedToUserId: userId } });
  await audit(ctx, { action: "opportunity.assign", entity: "Opportunity", entityId: id, after: { assignedToUserId: userId } });
}

// ── Requirements ───────────────────────────────────────────────

async function assertOppForRequirement(ctx: WorkspaceContext, opportunityId: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!opp) throw new Error("Opportunity not found");
}

export type RequirementUpsert = {
  key: string;
  label: string;
  valueType: string;
  value?: string | null;
  required?: boolean;
  confidence?: number | null;
  sourceMessageId?: string | null;
};

/** Upsert a requirement by (opportunity, key); status derives from value presence. */
export async function upsertRequirement(
  ctx: WorkspaceContext,
  opportunityId: string,
  input: RequirementUpsert,
) {
  requirePermission(ctx.member.role, "opportunities:manage");
  await assertOppForRequirement(ctx, opportunityId);
  const hasValue = input.value != null && String(input.value).trim() !== "";
  const status = hasValue ? "provided" : "missing";
  return prisma.customerRequirement.upsert({
    where: { opportunityId_key: { opportunityId, key: input.key } },
    create: {
      workspaceId: ctx.workspace.id,
      opportunityId,
      key: input.key,
      label: input.label,
      valueType: input.valueType,
      value: hasValue ? String(input.value) : null,
      status,
      required: input.required ?? true,
      confidence: input.confidence ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    },
    update: {
      // Don't clobber an agent-entered value with a null AI re-extraction.
      ...(hasValue ? { value: String(input.value), status: "provided" } : {}),
      label: input.label,
      valueType: input.valueType,
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
    },
  });
}

/** Set/clear a requirement's value manually (agent edit). */
export async function setRequirementValue(
  ctx: WorkspaceContext,
  requirementId: string,
  value: string | null,
) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const req = await prisma.customerRequirement.findFirst({
    where: { id: requirementId, workspaceId: ctx.workspace.id },
    select: { id: true, opportunityId: true },
  });
  if (!req) throw new Error("Requirement not found");
  const hasValue = value != null && value.trim() !== "";
  await prisma.customerRequirement.update({
    where: { id: requirementId },
    data: { value: hasValue ? value : null, status: hasValue ? "provided" : "missing", confidence: hasValue ? 1 : undefined },
  });
  await audit(ctx, {
    action: "opportunity.requirement",
    entity: "CustomerRequirement",
    entityId: requirementId,
    after: { value: hasValue ? value : null },
  });
}
