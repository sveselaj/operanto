import "server-only";
import { z } from "zod";
import { Prisma, type Property, type PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { runAITask } from "@/lib/ai/service";
import { generateContentTask } from "@/lib/ai/tasks";
import { queueSocialPost } from "@/verticals/real-estate/social-adapter";
import type { ToolDefinition } from "@/lib/tools/types";

/**
 * Real-estate (Pronatona) tools. This is the ONLY place `Property` is imported;
 * the generic core never references it. Availability, price, and status come
 * from the authoritative Property record — the assistant must not assert them
 * from memory.
 */

const propertyCard = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  type: z.string(),
  listingType: z.string(),
  status: z.string(),
  price: z.number(),
  currency: z.string(),
  areaSqm: z.number().int().nullable(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  city: z.string(),
  district: z.string().nullable(),
  media: z.array(z.string()),
  availabilityNote: z.string().nullable(),
});
type PropertyCard = z.infer<typeof propertyCard>;

function toCard(p: Property): PropertyCard {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    type: p.type,
    listingType: p.listingType,
    status: p.status,
    price: p.price,
    currency: p.currency,
    areaSqm: p.areaSqm,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    city: p.city,
    district: p.district,
    media: Array.isArray(p.media) ? (p.media as string[]) : [],
    availabilityNote: p.availabilityNote,
  };
}

async function findProperty(
  workspaceId: string,
  ref: { code?: string; propertyId?: string },
): Promise<Property | null> {
  if (ref.propertyId)
    return prisma.property.findFirst({ where: { id: ref.propertyId, workspaceId } });
  if (ref.code)
    return prisma.property.findFirst({
      where: { workspaceId, code: { equals: ref.code, mode: "insensitive" } },
    });
  return null;
}

// ── search_properties ─────────────────────────────────────────
export const searchPropertiesTool: ToolDefinition = {
  name: "search_properties",
  title: "Search properties",
  description: "Search the property catalogue by city, price, type, bedrooms, or status. Read-only.",
  category: "properties",
  risk: "read",
  permission: "properties:read",
  approval: "none",
  card: "property.list",
  inputSchema: z.object({
    query: z.string().optional(),
    city: z.string().optional(),
    type: z.enum(["apartment", "house", "villa", "land", "commercial", "office"]).optional(),
    listingType: z.enum(["sale", "rent"]).optional(),
    status: z.enum(["available", "reserved", "under_offer", "sold", "off_market"]).optional(),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    minBedrooms: z.number().int().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  outputSchema: z.object({ properties: z.array(propertyCard), total: z.number().int() }),
  async execute(exec, input) {
    const where: Prisma.PropertyWhereInput = { workspaceId: exec.ctx.workspace.id };
    if (input.city) where.city = { contains: input.city, mode: "insensitive" };
    if (input.type) where.type = input.type as PropertyType;
    if (input.listingType) where.listingType = input.listingType;
    where.status = input.status ?? "available";
    if (input.minPrice || input.maxPrice)
      where.price = { ...(input.minPrice ? { gte: input.minPrice } : {}), ...(input.maxPrice ? { lte: input.maxPrice } : {}) };
    if (typeof input.minBedrooms === "number") where.bedrooms = { gte: input.minBedrooms };
    if (input.query)
      where.OR = [
        { title: { contains: input.query, mode: "insensitive" } },
        { district: { contains: input.query, mode: "insensitive" } },
        { code: { contains: input.query, mode: "insensitive" } },
      ];
    const rows = await prisma.property.findMany({ where, orderBy: { price: "asc" }, take: input.limit });
    return { properties: rows.map(toCard), total: rows.length };
  },
  summarize: (out) => (out.total === 0 ? "No matching properties." : `Found ${out.total} property(ies).`),
};

// ── get_property ──────────────────────────────────────────────
export const getPropertyTool: ToolDefinition = {
  name: "get_property",
  title: "Open property",
  description: "Fetch one property's authoritative record by code or id. Read-only.",
  category: "properties",
  risk: "read",
  permission: "properties:read",
  approval: "none",
  card: "property.detail",
  inputSchema: z.object({ code: z.string().optional(), propertyId: z.string().optional() }),
  outputSchema: z.object({ property: propertyCard.nullable() }),
  async execute(exec, input) {
    const p = await findProperty(exec.ctx.workspace.id, input);
    return { property: p ? toCard(p) : null };
  },
  summarize: (out) => (out.property ? `Property ${out.property.code} — ${out.property.title}.` : "Property not found."),
};

// ── check_property_availability (grounding tool) ──────────────
export const checkPropertyAvailabilityTool: ToolDefinition = {
  name: "check_property_availability",
  title: "Check availability",
  description:
    "Return the AUTHORITATIVE current availability of a property. The assistant must call this before claiming a property is available.",
  category: "properties",
  risk: "read",
  permission: "properties:read",
  approval: "none",
  card: "property.availability",
  inputSchema: z.object({ code: z.string().optional(), propertyId: z.string().optional() }),
  outputSchema: z.object({
    found: z.boolean(),
    code: z.string().nullable(),
    status: z.string().nullable(),
    available: z.boolean(),
    availabilityNote: z.string().nullable(),
    price: z.number().nullable(),
    currency: z.string().nullable(),
    lastUpdated: z.string().nullable(),
  }),
  async execute(exec, input) {
    const p = await findProperty(exec.ctx.workspace.id, input);
    if (!p)
      return {
        found: false,
        code: input.code ?? null,
        status: null,
        available: false,
        availabilityNote: null,
        price: null,
        currency: null,
        lastUpdated: null,
      };
    return {
      found: true,
      code: p.code,
      status: p.status,
      available: p.status === "available",
      availabilityNote: p.availabilityNote,
      price: p.price,
      currency: p.currency,
      lastUpdated: p.updatedAt.toISOString(),
    };
  },
  summarize: (out) =>
    !out.found
      ? "Property not found."
      : out.available
        ? `${out.code} is currently AVAILABLE.`
        : `${out.code} is NOT available (status: ${out.status}).`,
};

// ── find_matching_properties ──────────────────────────────────
export const findMatchingPropertiesTool: ToolDefinition = {
  name: "find_matching_properties",
  title: "Find matching properties",
  description:
    "Find available properties matching a lead's requirements (from an opportunity or inline). Read-only.",
  category: "properties",
  risk: "read",
  permission: "properties:read",
  approval: "none",
  card: "property.list",
  inputSchema: z.object({
    opportunityId: z.string().optional(),
    propertyCode: z.string().optional().describe("Find properties similar to this one"),
    requirements: z
      .object({
        budgetMin: z.number().nullable().optional(),
        budgetMax: z.number().nullable().optional(),
        locations: z.array(z.string()).optional(),
        propertyType: z.string().nullable().optional(),
        bedrooms: z.number().int().nullable().optional(),
      })
      .optional(),
    limit: z.number().int().min(1).max(20).default(6),
  }),
  outputSchema: z.object({ properties: z.array(propertyCard), total: z.number().int(), basis: z.string() }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    let req = input.requirements ?? null;
    let basis = "inline requirements";
    if (!req && input.opportunityId) {
      const opp = await prisma.opportunity.findFirst({
        where: { id: input.opportunityId, workspaceId },
      });
      req = (opp?.requirements as typeof req) ?? null;
      basis = `opportunity ${input.opportunityId}`;
    }
    if (!req && input.propertyCode) {
      const base = await findProperty(workspaceId, { code: input.propertyCode });
      if (base) {
        req = {
          budgetMax: Math.round(base.price * 1.15),
          budgetMin: Math.round(base.price * 0.85),
          locations: [base.city],
          propertyType: base.type,
          bedrooms: base.bedrooms,
        };
        basis = `similar to ${base.code}`;
      }
    }
    const where: Prisma.PropertyWhereInput = { workspaceId, status: "available" };
    if (req?.budgetMax) where.price = { ...(where.price as object), lte: req.budgetMax };
    if (req?.budgetMin) where.price = { ...(where.price as object), gte: req.budgetMin };
    if (req?.propertyType) where.type = req.propertyType as PropertyType;
    if (req?.bedrooms) where.bedrooms = { gte: req.bedrooms };
    if (req?.locations?.length)
      where.OR = req.locations.flatMap((loc: string) => [
        { city: { contains: loc, mode: "insensitive" as const } },
        { district: { contains: loc, mode: "insensitive" as const } },
      ]);
    if (input.propertyCode) where.code = { not: input.propertyCode, mode: "insensitive" };
    const rows = await prisma.property.findMany({ where, orderBy: { price: "asc" }, take: input.limit });
    return { properties: rows.map(toCard), total: rows.length, basis };
  },
  summarize: (out) => `${out.total} match(es) (${out.basis}).`,
};

// ── draft_social_post (draft-only) ────────────────────────────
export const draftSocialPostTool: ToolDefinition = {
  name: "draft_social_post",
  title: "Draft social post",
  description:
    "Draft an on-brand social post for a property. Produces a DRAFT — nothing is published.",
  category: "social",
  risk: "draft",
  permission: "content:manage",
  approval: "none",
  card: "social.draft",
  inputSchema: z.object({
    propertyCode: z.string().optional(),
    propertyId: z.string().optional(),
    channel: z.enum(["instagram", "facebook", "tiktok"]).default("instagram"),
    language: z.string().default("sq"),
  }),
  outputSchema: z.object({
    contentDraftId: z.string(),
    channel: z.string(),
    language: z.string(),
    title: z.string(),
    body: z.string(),
    hashtags: z.array(z.string()),
    propertyCode: z.string().nullable(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const p = await findProperty(workspaceId, input);
    if (!p) throw new Error("Property not found");
    const bv = await prisma.brandVoice.findFirst({ where: { workspaceId } });
    const source = `Property ${p.code}: ${p.title}, ${p.type} in ${p.district ?? p.city}. ${
      p.price
    } ${p.currency}${p.areaSqm ? `, ${p.areaSqm} m²` : ""}${p.bedrooms ? `, ${p.bedrooms} bedrooms` : ""}. Status: ${p.status}.`;
    const res = await runAITask(exec.ctx, generateContentTask, {
      channel: input.channel,
      goal: `Promote property ${p.code} for ${input.language === "sq" ? "an Albanian" : "the target"} audience`,
      sourceText: source,
      brandVoice: bv
        ? { tone: bv.tone, dos: bv.dos, donts: bv.donts, examplePhrases: bv.examplePhrases }
        : null,
    });
    const body = `${res.data.hook}\n\n${res.data.caption}\n\n${res.data.cta}`;
    const draft = await prisma.contentDraft.create({
      data: {
        workspaceId,
        title: res.data.title || `${p.code} — ${input.channel}`,
        channel: input.channel,
        status: "draft",
        brandVoiceId: bv?.id ?? null,
        content: body,
        createdByUserId: exec.ctx.userId,
      },
    });
    return {
      contentDraftId: draft.id,
      channel: input.channel,
      language: input.language,
      title: draft.title,
      body,
      hashtags: res.data.hashtags,
      propertyCode: p.code,
    };
  },
  summarize: (out) => `Drafted a ${out.channel} post for ${out.propertyCode ?? "the property"} — not published.`,
};

// ── queue_social_post (sensitive) ─────────────────────────────
export const queueSocialPostTool: ToolDefinition = {
  name: "queue_social_post",
  title: "Publish / queue social post",
  description:
    "Queue an approved social post for publication. Sensitive — requires approval. Uses a mock publisher unless a real connector is configured.",
  category: "social",
  risk: "write",
  permission: "social:publish",
  approval: "always",
  idempotent: true,
  card: "social.queued",
  inputSchema: z.object({
    contentDraftId: z.string(),
    scheduledInHours: z.number().int().min(0).max(720).default(0),
  }),
  outputSchema: z.object({
    contentDraftId: z.string(),
    channel: z.string(),
    status: z.string(),
    scheduledAt: z.string(),
    externalRef: z.string(),
    adapter: z.string(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const draft = await prisma.contentDraft.findFirst({
      where: { id: input.contentDraftId, workspaceId },
    });
    if (!draft) throw new Error("Content draft not found");
    const scheduledAt = new Date(Date.now() + input.scheduledInHours * 3_600_000);
    const result = await queueSocialPost({
      channel: draft.channel,
      content: draft.content,
      scheduledAt,
    });
    await prisma.contentDraft.update({
      where: { id: draft.id },
      data: { status: "approved", scheduledAt },
    });
    await audit(exec.ctx, {
      action: "social.post.queued",
      entity: "ContentDraft",
      entityId: draft.id,
      correlationId: exec.correlationId,
      after: { adapter: result.adapter, externalRef: result.externalRef },
    });
    return {
      contentDraftId: draft.id,
      channel: draft.channel,
      status: "queued",
      scheduledAt: scheduledAt.toISOString(),
      externalRef: result.externalRef,
      adapter: result.adapter,
    };
  },
  summarize: (out) => `Queued ${out.channel} post via ${out.adapter} (${out.status}).`,
};

// ── request_viewing (draft-only) ──────────────────────────────
export const requestViewingTool: ToolDefinition = {
  name: "request_viewing",
  title: "Draft viewing invitation",
  description:
    "Draft a viewing invitation for a property to send to a customer. DRAFT only — not sent or booked.",
  category: "viewings",
  risk: "draft",
  permission: "conversations:reply",
  approval: "none",
  card: "viewing.request",
  inputSchema: z.object({
    propertyCode: z.string(),
    conversationId: z.string().optional(),
    customerName: z.string().optional(),
    preferredTime: z.string().optional(),
  }),
  outputSchema: z.object({
    draftId: z.string().nullable(),
    propertyCode: z.string(),
    body: z.string(),
    conversationId: z.string().nullable(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const p = await findProperty(workspaceId, { code: input.propertyCode });
    if (!p) throw new Error("Property not found");
    const name = input.customerName?.split(" ")[0] ?? "there";
    const when = input.preferredTime ? ` around ${input.preferredTime}` : " at a time that suits you";
    const body = `Hi ${name}! Would you like to view ${p.code} — ${p.title} in ${
      p.district ?? p.city
    }? I can arrange a viewing${when}. Shall I book it in?`;
    let draftId: string | null = null;
    if (input.conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: input.conversationId, workspaceId },
        select: { id: true, channelType: true },
      });
      if (conv) {
        const draft = await prisma.messageDraft.create({
          data: {
            workspaceId,
            conversationId: conv.id,
            channel: conv.channelType,
            body,
            status: "draft",
            createdByUserId: exec.ctx.userId,
          },
        });
        draftId = draft.id;
      }
    }
    return { draftId, propertyCode: p.code, body, conversationId: input.conversationId ?? null };
  },
  summarize: (out) => `Drafted a viewing invitation for ${out.propertyCode} — not sent.`,
};

// ── schedule_viewing (sensitive) ──────────────────────────────
export const scheduleViewingTool: ToolDefinition = {
  name: "schedule_viewing",
  title: "Schedule viewing",
  description:
    "Book a property viewing (creates a dated task/appointment). Sensitive — requires approval.",
  category: "viewings",
  risk: "write",
  permission: "properties:manage",
  approval: "always",
  idempotent: true,
  card: "viewing.scheduled",
  inputSchema: z.object({
    propertyCode: z.string(),
    at: z.string().describe("ISO datetime for the viewing"),
    contactId: z.string().optional(),
    conversationId: z.string().optional(),
    agentUserId: z.string().optional(),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    propertyCode: z.string(),
    at: z.string(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const p = await findProperty(workspaceId, { code: input.propertyCode });
    if (!p) throw new Error("Property not found");
    const at = new Date(input.at);
    if (Number.isNaN(at.getTime())) throw new Error("Invalid viewing time");
    const task = await prisma.task.create({
      data: {
        workspaceId,
        title: `Viewing — ${p.code} (${p.title})`,
        description: `Property viewing for ${p.code} at ${at.toISOString()}.`,
        status: "todo",
        priority: "high",
        assignedToUserId: input.agentUserId ?? p.assignedAgentUserId ?? exec.ctx.userId,
        createdByUserId: exec.ctx.userId,
        dueAt: at,
        linkedConversationId: input.conversationId ?? null,
        linkedCustomerId: input.contactId ?? null,
      },
    });
    await audit(exec.ctx, {
      action: "viewing.scheduled",
      entity: "Task",
      entityId: task.id,
      correlationId: exec.correlationId,
      after: { propertyCode: p.code, at: at.toISOString() },
    });
    return { taskId: task.id, propertyCode: p.code, at: at.toISOString() };
  },
  summarize: (out) => `Booked a viewing for ${out.propertyCode}.`,
};

// ── get_agent_availability ────────────────────────────────────
export const getAgentAvailabilityTool: ToolDefinition = {
  name: "get_agent_availability",
  title: "Agent availability",
  description:
    "Suggest available viewing slots for an agent over the coming days. (Derived; no live calendar integration.) Read-only.",
  category: "viewings",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "agent.availability",
  inputSchema: z.object({
    agentUserId: z.string().optional(),
    days: z.number().int().min(1).max(14).default(5),
  }),
  outputSchema: z.object({
    agentUserId: z.string().nullable(),
    agentName: z.string().nullable(),
    slots: z.array(z.object({ at: z.string(), label: z.string() })),
    note: z.string(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const userId = input.agentUserId ?? exec.ctx.userId;
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      include: { user: { select: { name: true } } },
    });
    // Derived slots: 11:00 and 16:00 on each of the next N weekdays.
    const slots: { at: string; label: string }[] = [];
    const base = new Date();
    for (let d = 1; slots.length < input.days * 2 && d <= 21; d++) {
      const day = new Date(base.getTime() + d * 86_400_000);
      const dow = day.getDay();
      if (dow === 0) continue; // skip Sundays
      for (const hour of [11, 16]) {
        const slot = new Date(day);
        slot.setHours(hour, 0, 0, 0);
        slots.push({
          at: slot.toISOString(),
          label: `${slot.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${hour}:00`,
        });
      }
    }
    return {
      agentUserId: member ? userId : null,
      agentName: member?.user.name ?? null,
      slots: slots.slice(0, input.days * 2),
      note: "Suggested slots are derived (no live calendar). Confirm with the agent before booking.",
    };
  },
  summarize: (out) => `${out.slots.length} suggested slots${out.agentName ? ` for ${out.agentName}` : ""}.`,
};

export const realEstateTools: ToolDefinition[] = [
  searchPropertiesTool,
  getPropertyTool,
  checkPropertyAvailabilityTool,
  findMatchingPropertiesTool,
  draftSocialPostTool,
  queueSocialPostTool,
  requestViewingTool,
  scheduleViewingTool,
  getAgentAvailabilityTool,
];
