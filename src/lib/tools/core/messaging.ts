import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { runAITask } from "@/lib/ai/service";
import { draftConversationReply } from "@/lib/services/ai-inbox";
import { translateTask } from "@/lib/ai/assistant-tasks";
import { getConnector, ConnectorError } from "@/lib/channels";
import type { ToolDefinition } from "@/lib/tools/types";

// ── draft_customer_reply (draft-only) ─────────────────────────
export const draftCustomerReplyTool: ToolDefinition = {
  name: "draft_customer_reply",
  title: "Draft customer reply",
  description:
    "Draft an on-brand reply to a customer conversation. Produces a DRAFT only — it is never sent.",
  category: "messaging",
  risk: "draft",
  permission: "conversations:reply",
  approval: "none",
  card: "message.draft",
  inputSchema: z.object({
    conversationId: z.string(),
    instruction: z.string().optional().describe("Optional steering, e.g. 'offer a viewing'"),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    conversationId: z.string(),
    channel: z.string(),
    body: z.string(),
    risk: z.enum(["low", "medium", "high"]),
    confidence: z.number().nullable(),
    recommendedFollowUp: z.string().nullable(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId },
      select: { id: true, channelType: true },
    });
    if (!conv) throw new Error("Conversation not found");
    const drafted = await draftConversationReply(exec.ctx, conv.id, input.instruction);
    const draft = await prisma.messageDraft.create({
      data: {
        workspaceId,
        conversationId: conv.id,
        channel: conv.channelType,
        body: drafted.reply,
        status: "draft",
        createdByUserId: exec.ctx.userId,
      },
    });
    return {
      draftId: draft.id,
      conversationId: conv.id,
      channel: conv.channelType,
      body: drafted.reply,
      risk: drafted.risk,
      confidence: drafted.confidence ?? null,
      recommendedFollowUp: drafted.recommendedFollowUp,
    };
  },
  summarize: () => "Prepared a reply draft — not sent.",
};

// ── translate_message (read/draft) ────────────────────────────
export const translateMessageTool: ToolDefinition = {
  name: "translate_message",
  title: "Translate text",
  description: "Translate a message into a target language. Produces text only, no side effects.",
  category: "messaging",
  risk: "read",
  permission: "conversations:read",
  approval: "none",
  card: "message.translation",
  inputSchema: z.object({
    text: z.string().min(1),
    targetLanguage: z.string().min(2).describe("Target language, e.g. 'English' or 'sq'"),
  }),
  outputSchema: z.object({
    translated: z.string(),
    targetLanguage: z.string(),
    confidence: z.number().nullable(),
  }),
  async execute(exec, input) {
    const res = await runAITask(exec.ctx, translateTask, {
      text: input.text,
      targetLanguage: input.targetLanguage,
    });
    return {
      translated: res.data.translated,
      targetLanguage: input.targetLanguage,
      confidence: res.confidence,
    };
  },
  summarize: (out) => `Translated to ${out.targetLanguage}.`,
};

// ── send_customer_message (sensitive) ─────────────────────────
export const sendCustomerMessageTool: ToolDefinition = {
  name: "send_customer_message",
  title: "Send customer message",
  description:
    "Send an outbound message to a customer through their channel. Sensitive — requires approval.",
  category: "messaging",
  risk: "write",
  permission: "conversations:reply",
  approval: "always",
  idempotent: true,
  card: "message.sent",
  inputSchema: z.object({
    conversationId: z.string(),
    body: z.string().min(1),
    draftId: z.string().optional(),
  }),
  outputSchema: z.object({
    messageId: z.string(),
    conversationId: z.string(),
    channel: z.string(),
    delivered: z.boolean(),
  }),
  async execute(exec, input) {
    const workspaceId = exec.ctx.workspace.id;
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId },
      include: { customer: true },
    });
    if (!conv) throw new Error("Conversation not found");

    // Attempt external delivery FIRST. If the connector isn't wired (stubs for
    // Instagram/WhatsApp/etc.), this throws and NO message is recorded — the
    // invocation fails and the operator sees "failed, nothing was sent".
    const connector = getConnector(conv.channelType);
    const recipient =
      conv.customer?.email ??
      conv.customer?.phone ??
      (conv.customer?.socialHandles as { externalId?: string } | null)?.externalId ??
      conv.customerId ??
      "unknown";
    try {
      await connector.sendMessage(recipient, input.body);
    } catch (err) {
      if (err instanceof ConnectorError) {
        throw new Error(`Channel not connected: ${err.message}`);
      }
      throw err;
    }

    const now = new Date();
    const message = await prisma.message.create({
      data: {
        workspaceId,
        conversationId: conv.id,
        direction: "outbound",
        senderType: "agent",
        senderUserId: exec.ctx.userId,
        body: input.body,
      },
    });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: now, lastOutboundAt: now },
    });
    if (input.draftId) {
      await prisma.messageDraft.updateMany({
        where: { id: input.draftId, workspaceId },
        data: { status: "sent", approvedByUserId: exec.ctx.userId, sentAt: now },
      });
    }
    await audit(exec.ctx, {
      action: "customer.reply.sent",
      entity: "Message",
      entityId: message.id,
      correlationId: exec.correlationId,
    });
    return { messageId: message.id, conversationId: conv.id, channel: conv.channelType, delivered: true };
  },
  summarize: (out) => `Sent message on ${out.channel}.`,
};
