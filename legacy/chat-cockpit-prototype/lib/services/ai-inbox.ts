import "server-only";
import type { Intent, Sentiment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { WorkspaceContext } from "@/lib/workspace";
import { audit } from "@/lib/audit";
import { runAITask } from "@/lib/ai/service";
import { runAutomationsForConversation } from "@/lib/services/automations";
import {
  summarizeTask,
  classifyTask,
  draftReplyTask,
  type ConversationAIInput,
} from "@/lib/ai/tasks";
import type { DraftReplyOutput } from "@/lib/ai/tasks";

/** Build the AI input context for a conversation, scoped to the workspace. */
async function buildContext(
  ctx: WorkspaceContext,
  conversationId: string,
): Promise<ConversationAIInput> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspace.id },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "asc" }, take: 30 },
    },
  });
  if (!conv) throw new Error("Conversation not found");

  // First brand voice for the workspace (Studio will let users pick later).
  const brandVoice = await prisma.brandVoice.findFirst({
    where: { workspaceId: ctx.workspace.id },
  });

  return {
    channel: conv.channelType,
    subject: conv.subject,
    customerName: conv.customer?.name ?? null,
    brandVoice: brandVoice
      ? {
          tone: brandVoice.tone,
          dos: brandVoice.dos,
          donts: brandVoice.donts,
          examplePhrases: brandVoice.examplePhrases,
        }
      : null,
    messages: conv.messages
      .filter((m) => m.direction !== "internal")
      .map((m) => ({
        role: m.direction === "inbound" ? ("customer" as const) : ("agent" as const),
        body: m.body,
      })),
  };
}

/**
 * Analyze a conversation: summarize + classify, then persist the derived fields
 * (summary, intent, sentiment, leadScore) onto the conversation. This is safe
 * metadata — no customer message is sent.
 */
export async function analyzeConversation(ctx: WorkspaceContext, conversationId: string) {
  const input = await buildContext(ctx, conversationId);

  const [summary, classification] = await Promise.all([
    runAITask(ctx, summarizeTask, input),
    runAITask(ctx, classifyTask, input),
  ]);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      summary: summary.data.summary,
      intent: classification.data.intent as Intent,
      sentiment: classification.data.sentiment as Sentiment,
      leadScore: classification.data.leadScore,
    },
  });

  await audit(ctx, {
    action: "conversation.analyze",
    entity: "Conversation",
    entityId: conversationId,
    after: {
      intent: classification.data.intent,
      sentiment: classification.data.sentiment,
      leadScore: classification.data.leadScore,
    },
  });

  // Fire automations now that intent/sentiment/leadScore are set.
  await runAutomationsForConversation(
    { workspaceId: ctx.workspace.id, actorUserId: ctx.userId },
    "conversation_analyzed",
    conversationId,
  );

  return {
    summary: summary.data,
    classification: classification.data,
    recommendedNextAction: summary.data.recommendedNextAction,
  };
}

/**
 * Draft a reply suggestion. Returns the draft for the agent to edit and send —
 * it is never sent automatically.
 */
export async function draftConversationReply(
  ctx: WorkspaceContext,
  conversationId: string,
  instruction?: string,
): Promise<DraftReplyOutput & { aiActionId: string }> {
  const input = await buildContext(ctx, conversationId);
  const res = await runAITask(ctx, draftReplyTask, { ...input, instruction });
  return { ...res.data, aiActionId: res.aiActionId };
}
