import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAITask } from "@/lib/ai/service";
import { summarizeTask, type ConversationAIInput } from "@/lib/ai/tasks";
import type { ToolDefinition } from "@/lib/tools/types";

const conversationRow = z.object({
  id: z.string(),
  subject: z.string().nullable(),
  channelType: z.string(),
  status: z.string(),
  intent: z.string().nullable(),
  sentiment: z.string().nullable(),
  leadScore: z.number().int().nullable(),
  summary: z.string().nullable(),
  customerName: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  lastOutboundAt: z.string().nullable(),
});

// ── search_conversations ──────────────────────────────────────
export const searchConversationsTool: ToolDefinition = {
  name: "search_conversations",
  title: "Search conversations",
  description:
    "Find customer conversations by text, status, intent, channel, lead score, assignment, or 'not contacted in N days'. Read-only.",
  category: "conversations",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "conversation.list",
  inputSchema: z.object({
    query: z.string().optional(),
    status: z
      .enum(["open", "pending", "waiting_customer", "resolved", "archived"])
      .optional(),
    intent: z.string().optional(),
    channelType: z
      .enum(["instagram", "facebook", "whatsapp", "email", "sms", "webchat", "manual"])
      .optional(),
    leadScoreGte: z.number().int().min(0).max(100).optional(),
    assignedToMe: z.boolean().optional(),
    notContactedForDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Only conversations with no outbound reply in the last N days"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  outputSchema: z.object({ conversations: z.array(conversationRow), total: z.number().int() }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const where: Prisma.ConversationWhereInput = { workspaceId };
    if (input.status) where.status = input.status;
    if (input.intent) where.intent = input.intent as Prisma.ConversationWhereInput["intent"];
    if (input.channelType)
      where.channelType = input.channelType as Prisma.ConversationWhereInput["channelType"];
    if (typeof input.leadScoreGte === "number") where.leadScore = { gte: input.leadScoreGte };
    if (input.assignedToMe) where.assignedToUserId = exec.ctx.userId;
    if (input.query) {
      where.OR = [
        { subject: { contains: input.query, mode: "insensitive" } },
        { summary: { contains: input.query, mode: "insensitive" } },
      ];
    }
    if (typeof input.notContactedForDays === "number") {
      const cutoff = new Date(Date.now() - input.notContactedForDays * 86_400_000);
      where.AND = [
        { OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: cutoff } }] },
        { status: { in: ["open", "pending", "waiting_customer"] } },
      ];
    }
    const rows = await prisma.conversation.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: [{ priority: "desc" }, { lastMessageAt: "desc" }],
      take: input.limit,
    });
    return {
      conversations: rows.map((c) => ({
        id: c.id,
        subject: c.subject,
        channelType: c.channelType,
        status: c.status,
        intent: c.intent,
        sentiment: c.sentiment,
        leadScore: c.leadScore,
        summary: c.summary,
        customerName: c.customer?.name ?? null,
        lastInboundAt: c.lastInboundAt ? c.lastInboundAt.toISOString() : null,
        lastOutboundAt: c.lastOutboundAt ? c.lastOutboundAt.toISOString() : null,
      })),
      total: rows.length,
    };
  },
  summarize: (out) =>
    out.total === 0 ? "No matching conversations." : `Found ${out.total} conversation(s).`,
};

// ── summarize_conversation ────────────────────────────────────
export const summarizeConversationTool: ToolDefinition = {
  name: "summarize_conversation",
  title: "Summarize conversation",
  description: "Produce a grounded summary + recommended next action for one conversation.",
  category: "conversations",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "conversation.summary",
  inputSchema: z.object({ conversationId: z.string() }),
  outputSchema: z.object({
    conversationId: z.string(),
    summary: z.string(),
    recommendedNextAction: z.string(),
    unresolvedQuestion: z.string().nullable(),
    confidence: z.number().nullable(),
  }),
  async execute(exec, input) {
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: exec.ctx.workspace.id },
      include: {
        customer: { select: { name: true } },
        messages: { orderBy: { createdAt: "asc" }, take: 50 },
      },
    });
    if (!conv) throw new Error("Conversation not found");
    const aiInput: ConversationAIInput = {
      channel: conv.channelType,
      subject: conv.subject,
      customerName: conv.customer?.name ?? null,
      messages: conv.messages.map((m) => ({
        role: m.senderType === "customer" ? "customer" : "agent",
        body: m.body,
      })),
    };
    const res = await runAITask(exec.ctx, summarizeTask, aiInput);
    return {
      conversationId: conv.id,
      summary: res.data.summary,
      recommendedNextAction: res.data.recommendedNextAction,
      unresolvedQuestion: res.data.unresolvedQuestion,
      confidence: res.confidence,
    };
  },
  summarize: (out) => out.summary.slice(0, 120),
};
