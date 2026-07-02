import "server-only";
import { z } from "zod";
import { Prisma, type OpportunityStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ToolDefinition } from "@/lib/tools/types";

const STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;

const requirementsSchema = z
  .object({
    budgetMin: z.number().nullable().optional(),
    budgetMax: z.number().nullable().optional(),
    locations: z.array(z.string()).optional(),
    propertyType: z.string().nullable().optional(),
    bedrooms: z.number().int().nullable().optional(),
    timeline: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

const opportunityRow = z.object({
  id: z.string(),
  title: z.string(),
  stage: z.enum(STAGES),
  value: z.number().nullable(),
  currency: z.string(),
  leadScore: z.number().int().nullable(),
  contactName: z.string().nullable(),
  ownerName: z.string().nullable(),
  nextAction: z.string().nullable(),
  requirements: requirementsSchema.nullable(),
  lastActivityAt: z.string().nullable(),
});

type OppWithRels = Prisma.OpportunityGetPayload<{
  include: { contact: { select: { name: true } }; owner: { select: { name: true } } };
}>;

function toRow(o: OppWithRels): z.infer<typeof opportunityRow> {
  return {
    id: o.id,
    title: o.title,
    stage: o.stage,
    value: o.value,
    currency: o.currency,
    leadScore: o.leadScore,
    contactName: o.contact?.name ?? null,
    ownerName: o.owner?.name ?? null,
    nextAction: o.nextAction,
    requirements: (o.requirements as z.infer<typeof requirementsSchema> | null) ?? null,
    lastActivityAt: o.lastActivityAt ? o.lastActivityAt.toISOString() : null,
  };
}

const includeRels = { contact: { select: { name: true } }, owner: { select: { name: true } } };

// ── search_opportunities ──────────────────────────────────────
export const searchOpportunitiesTool: ToolDefinition = {
  name: "search_opportunities",
  title: "Search opportunities",
  description: "Find CRM opportunities/leads by stage, owner, value, or budget requirements. Read-only.",
  category: "opportunities",
  risk: "read",
  permission: "opportunities:read",
  approval: "none",
  card: "opportunity.list",
  inputSchema: z.object({
    query: z.string().optional(),
    stage: z.enum(STAGES).optional(),
    ownedByMe: z.boolean().optional(),
    minLeadScore: z.number().int().min(0).max(100).optional(),
    budgetMin: z.number().optional().describe("Only leads whose max budget is at least this"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  outputSchema: z.object({ opportunities: z.array(opportunityRow), total: z.number().int() }),
  async execute(exec, input) {
    const where: Prisma.OpportunityWhereInput = { workspaceId: exec.ctx.workspace.id };
    if (input.stage) where.stage = input.stage as OpportunityStage;
    if (input.ownedByMe) where.ownerUserId = exec.ctx.userId;
    if (typeof input.minLeadScore === "number") where.leadScore = { gte: input.minLeadScore };
    if (input.query) where.title = { contains: input.query, mode: "insensitive" };
    const rows = await prisma.opportunity.findMany({
      where,
      include: includeRels,
      orderBy: [{ leadScore: "desc" }, { updatedAt: "desc" }],
      take: input.limit,
    });
    let mapped = rows.map(toRow);
    // Budget filter over the JSON requirements is applied in-memory (small result set).
    if (typeof input.budgetMin === "number") {
      mapped = mapped.filter((o) => (o.requirements?.budgetMax ?? 0) >= input.budgetMin!);
    }
    return { opportunities: mapped, total: mapped.length };
  },
  summarize: (out) =>
    out.total === 0 ? "No matching opportunities." : `Found ${out.total} opportunity(ies).`,
};

// ── create_opportunity ────────────────────────────────────────
export const createOpportunityTool: ToolDefinition = {
  name: "create_opportunity",
  title: "Create opportunity",
  description: "Create a CRM opportunity/lead, optionally linked to a contact and conversation.",
  category: "opportunities",
  risk: "write",
  permission: "opportunities:manage",
  approval: "none",
  card: "opportunity.detail",
  inputSchema: z.object({
    title: z.string().min(1),
    stage: z.enum(STAGES).default("new"),
    value: z.number().optional(),
    currency: z.string().default("EUR"),
    contactId: z.string().optional(),
    conversationId: z.string().optional(),
    source: z.string().optional(),
    nextAction: z.string().optional(),
    requirements: requirementsSchema.optional(),
    linkedRecordType: z.string().optional(),
    linkedRecordId: z.string().optional(),
  }),
  outputSchema: z.object({ opportunity: opportunityRow }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    if (input.contactId) {
      const c = await prisma.customer.findFirst({ where: { id: input.contactId, workspaceId } });
      if (!c) throw new Error("Contact not found in this workspace");
    }
    const created = await prisma.opportunity.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        stage: input.stage as OpportunityStage,
        value: input.value ?? null,
        currency: input.currency,
        contactCustomerId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        ownerUserId: exec.ctx.userId,
        source: input.source ?? "assistant",
        nextAction: input.nextAction ?? null,
        requirements: (input.requirements as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        linkedRecordType: input.linkedRecordType ?? null,
        linkedRecordId: input.linkedRecordId ?? null,
        lastActivityAt: new Date(),
        createdByUserId: exec.ctx.userId,
      },
      include: includeRels,
    });
    return { opportunity: toRow(created) };
  },
  summarize: (out) => `Created opportunity "${out.opportunity.title}".`,
};

// ── update_opportunity_stage (sensitive) ──────────────────────
export const updateOpportunityStageTool: ToolDefinition = {
  name: "update_opportunity_stage",
  title: "Change opportunity stage",
  description: "Move an opportunity to a new pipeline stage. Sensitive — requires approval.",
  category: "opportunities",
  risk: "write",
  permission: "opportunities:manage",
  approval: "always",
  idempotent: true,
  card: "opportunity.detail",
  inputSchema: z.object({ opportunityId: z.string(), stage: z.enum(STAGES) }),
  outputSchema: z.object({ opportunity: opportunityRow }),
  async execute(exec, input) {
    const existing = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, workspaceId: exec.ctx.workspace.id },
    });
    if (!existing) throw new Error("Opportunity not found");
    const updated = await prisma.opportunity.update({
      where: { id: existing.id },
      data: { stage: input.stage as OpportunityStage, lastActivityAt: new Date() },
      include: includeRels,
    });
    return { opportunity: toRow(updated) };
  },
  summarize: (out) => `Moved "${out.opportunity.title}" to ${out.opportunity.stage}.`,
};

// ── assign_opportunity (sensitive) ────────────────────────────
export const assignOpportunityTool: ToolDefinition = {
  name: "assign_opportunity",
  title: "Assign opportunity",
  description: "Assign an opportunity to a team member. Sensitive — requires approval.",
  category: "opportunities",
  risk: "write",
  permission: "opportunities:manage",
  approval: "always",
  idempotent: true,
  card: "opportunity.detail",
  inputSchema: z.object({ opportunityId: z.string(), ownerUserId: z.string() }),
  outputSchema: z.object({ opportunity: opportunityRow }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const existing = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, workspaceId },
    });
    if (!existing) throw new Error("Opportunity not found");
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: input.ownerUserId, status: "active" },
    });
    if (!member) throw new Error("Assignee is not a member of this workspace");
    const updated = await prisma.opportunity.update({
      where: { id: existing.id },
      data: { ownerUserId: input.ownerUserId, lastActivityAt: new Date() },
      include: includeRels,
    });
    return { opportunity: toRow(updated) };
  },
  summarize: (out) => `Assigned "${out.opportunity.title}" to ${out.opportunity.ownerName ?? "a member"}.`,
};

// ── update_lead_requirements ──────────────────────────────────
export const updateLeadRequirementsTool: ToolDefinition = {
  name: "update_lead_requirements",
  title: "Update lead requirements",
  description: "Save structured requirements (budget, area, timeline) and lead score on an opportunity.",
  category: "opportunities",
  risk: "write",
  permission: "opportunities:manage",
  approval: "none",
  card: "opportunity.detail",
  inputSchema: z.object({
    opportunityId: z.string(),
    requirements: requirementsSchema,
    leadScore: z.number().int().min(0).max(100).optional(),
  }),
  outputSchema: z.object({ opportunity: opportunityRow }),
  async execute(exec, input) {
    const existing = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, workspaceId: exec.ctx.workspace.id },
    });
    if (!existing) throw new Error("Opportunity not found");
    const merged = { ...(existing.requirements as object | null), ...input.requirements };
    const updated = await prisma.opportunity.update({
      where: { id: existing.id },
      data: {
        requirements: merged as Prisma.InputJsonValue,
        ...(typeof input.leadScore === "number" ? { leadScore: input.leadScore } : {}),
        lastActivityAt: new Date(),
      },
      include: includeRels,
    });
    return { opportunity: toRow(updated) };
  },
  summarize: (out) => `Updated requirements for "${out.opportunity.title}".`,
};
