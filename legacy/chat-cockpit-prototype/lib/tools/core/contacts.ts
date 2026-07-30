import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { ToolDefinition } from "@/lib/tools/types";

const contactSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  language: z.string().nullable(),
  location: z.string().nullable(),
  conversationCount: z.number().int(),
  lastActivityAt: z.string().nullable(),
});

// ── search_contacts ───────────────────────────────────────────
export const searchContactsTool: ToolDefinition = {
  name: "search_contacts",
  title: "Search contacts",
  description:
    "Find contacts/leads by name, email, phone, location (e.g. country), or language. Read-only.",
  category: "contacts",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "contact.list",
  inputSchema: z.object({
    query: z.string().optional().describe("Free text: name, email, phone, or handle"),
    location: z.string().optional().describe("Filter by contact location/country, e.g. 'Germany'"),
    language: z.string().optional().describe("Two-letter language code, e.g. 'de'"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  outputSchema: z.object({ contacts: z.array(contactSchema), total: z.number().int() }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const q = input.query?.trim();
    const rows = await prisma.customer.findMany({
      where: {
        workspaceId,
        ...(input.location ? { location: { contains: input.location, mode: "insensitive" } } : {}),
        ...(input.language ? { language: { equals: input.language, mode: "insensitive" } } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { conversations: { select: { lastMessageAt: true } } },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
    });
    const contacts = rows.map((c) => {
      const last = c.conversations
        .map((v) => v.lastMessageAt)
        .filter(Boolean)
        .sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] as Date | undefined;
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        language: c.language,
        location: c.location,
        conversationCount: c.conversations.length,
        lastActivityAt: last ? last.toISOString() : null,
      };
    });
    return { contacts, total: contacts.length };
  },
  summarize: (out) =>
    out.total === 0 ? "No matching contacts." : `Found ${out.total} contact(s).`,
};

// ── get_contact ───────────────────────────────────────────────
export const getContactTool: ToolDefinition = {
  name: "get_contact",
  title: "Open contact",
  description: "Fetch a single contact by id with core details. Read-only.",
  category: "contacts",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "contact.detail",
  inputSchema: z.object({ contactId: z.string() }),
  outputSchema: z.object({ contact: contactSchema.nullable() }),
  async execute(exec, input) {
    const c = await prisma.customer.findFirst({
      where: { id: input.contactId, workspaceId: exec.ctx.workspace.id },
      include: { conversations: { select: { lastMessageAt: true } } },
    });
    if (!c) return { contact: null };
    const last = c.conversations
      .map((v) => v.lastMessageAt)
      .filter(Boolean)
      .sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] as Date | undefined;
    return {
      contact: {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        language: c.language,
        location: c.location,
        conversationCount: c.conversations.length,
        lastActivityAt: last ? last.toISOString() : null,
      },
    };
  },
  summarize: (out) => (out.contact ? `Contact ${out.contact.name ?? out.contact.id}.` : "Contact not found."),
};

// ── get_customer_history ──────────────────────────────────────
export const getCustomerHistoryTool: ToolDefinition = {
  name: "get_customer_history",
  title: "Customer history",
  description: "List a contact's previous conversations (most recent first). Read-only.",
  category: "contacts",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "conversation.list",
  inputSchema: z.object({
    contactId: z.string(),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    conversations: z.array(
      z.object({
        id: z.string(),
        subject: z.string().nullable(),
        channelType: z.string(),
        status: z.string(),
        summary: z.string().nullable(),
        lastMessageAt: z.string().nullable(),
      }),
    ),
    total: z.number().int(),
  }),
  async execute(exec, input) {
    const rows = await prisma.conversation.findMany({
      where: { workspaceId: exec.ctx.workspace.id, customerId: input.contactId },
      orderBy: { lastMessageAt: "desc" },
      take: input.limit,
    });
    return {
      conversations: rows.map((c) => ({
        id: c.id,
        subject: c.subject,
        channelType: c.channelType,
        status: c.status,
        summary: c.summary,
        lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      })),
      total: rows.length,
    };
  },
  summarize: (out) => `${out.total} previous conversation(s).`,
};
