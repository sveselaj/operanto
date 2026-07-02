import "server-only";
import type { AssistantThread, AssistantThreadMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";
import { runAITask } from "@/lib/ai/service";
import {
  planAssistantTurnTask,
  composeAssistantReplyTask,
  type ComposeInput,
  type PlanTurnInput,
} from "@/lib/ai/assistant-tasks";
import { getVertical } from "@/lib/verticals/registry";
import { getVisibleTools, getTool, toCatalog } from "@/lib/tools/registry";
import { runTool, type RunToolOutcome } from "@/lib/tools/runtime";
import type { AssistantStructuredContent, CockpitBlock, ToolExecutionContext } from "@/lib/tools/types";

const DEFAULT_TITLE = "New chat";

export async function listThreads(ctx: WorkspaceContext, mode?: AssistantThreadMode) {
  requirePermission(ctx.member.role, "assistant:use");
  return prisma.assistantThread.findMany({
    where: { workspaceId: ctx.workspace.id, archivedAt: null, ...(mode ? { mode } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true, createdAt: true } },
    },
  });
}

export async function createThread(
  ctx: WorkspaceContext,
  input: { title?: string; mode?: AssistantThreadMode; linkedConversationId?: string } = {},
) {
  requirePermission(ctx.member.role, "assistant:use");
  const thread = await prisma.assistantThread.create({
    data: {
      workspaceId: ctx.workspace.id,
      title: input.title?.trim() || DEFAULT_TITLE,
      mode: input.mode ?? "internal_assistant",
      linkedConversationId: input.linkedConversationId ?? null,
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "assistant.thread.created", entity: "AssistantThread", entityId: thread.id });
  return thread;
}

/** Find (or create) the assistant thread bound to a customer conversation. */
export async function getOrCreateConversationThread(ctx: WorkspaceContext, conversationId: string) {
  requirePermission(ctx.member.role, "assistant:use");
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspace.id },
    include: { customer: { select: { name: true } } },
  });
  if (!conv) throw new Error("Conversation not found");
  const existing = await prisma.assistantThread.findFirst({
    where: {
      workspaceId: ctx.workspace.id,
      mode: "customer_conversation",
      linkedConversationId: conversationId,
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  const title = (conv.subject || conv.customer?.name || "Customer conversation").slice(0, 60);
  const thread = await prisma.assistantThread.create({
    data: {
      workspaceId: ctx.workspace.id,
      title,
      mode: "customer_conversation",
      linkedConversationId: conversationId,
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "assistant.thread.created", entity: "AssistantThread", entityId: thread.id });
  return thread;
}

export async function getThread(ctx: WorkspaceContext, threadId: string) {
  requirePermission(ctx.member.role, "assistant:use");
  const thread = await prisma.assistantThread.findFirst({
    where: { id: threadId, workspaceId: ctx.workspace.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  if (!thread) throw new Error("Thread not found");
  return thread;
}

export async function archiveThread(ctx: WorkspaceContext, threadId: string) {
  requirePermission(ctx.member.role, "assistant:use");
  const thread = await prisma.assistantThread.findFirst({
    where: { id: threadId, workspaceId: ctx.workspace.id },
  });
  if (!thread) throw new Error("Thread not found");
  await prisma.assistantThread.update({ where: { id: thread.id }, data: { archivedAt: new Date() } });
  await audit(ctx, { action: "assistant.thread.archived", entity: "AssistantThread", entityId: thread.id });
}

// ─────────────────────────────────────────────────────────────
// Turn execution (shared by streaming + non-streaming paths)
// ─────────────────────────────────────────────────────────────

export type TurnMessage = {
  id: string;
  role: string;
  content: string;
  structuredContent: AssistantStructuredContent | null;
  confidence: number | null;
  createdAt: string;
  authorName: string | null;
};

export type TurnEvent =
  | { type: "user"; message: TurnMessage }
  | { type: "block"; block: CockpitBlock }
  | { type: "text"; delta: string }
  | { type: "done"; message: TurnMessage };

function serialize(
  m: { id: string; role: string; content: string; structuredContent: unknown; confidence: number | null; createdAt: Date },
  authorName: string | null,
): TurnMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    structuredContent: (m.structuredContent as AssistantStructuredContent | null) ?? null,
    confidence: m.confidence ?? null,
    createdAt: m.createdAt.toISOString(),
    authorName,
  };
}

/** Context injected when a thread is bound to a customer conversation. */
async function buildConversationContext(
  ctx: WorkspaceContext,
  thread: AssistantThread,
): Promise<PlanTurnInput["context"] | null> {
  if (thread.mode !== "customer_conversation" || !thread.linkedConversationId) return null;
  const conv = await prisma.conversation.findFirst({
    where: { id: thread.linkedConversationId, workspaceId: ctx.workspace.id },
    include: { customer: { select: { name: true } }, contextLinks: true },
  });
  if (!conv) return null;
  const propLink = conv.contextLinks.find((l) => l.recordType === "property");
  return {
    conversationId: conv.id,
    customerName: conv.customer?.name ?? undefined,
    channel: conv.channelType,
    propertyCode: propLink?.label ?? undefined,
  };
}

/** Split text into small chunks at word boundaries for progressive streaming. */
function chunkText(text: string, wordsPerChunk = 4): string[] {
  const tokens = text.split(/(\s+)/).filter((s) => s !== "");
  const chunks: string[] = [];
  let cur = "";
  let words = 0;
  for (const tok of tokens) {
    cur += tok;
    if (!/^\s+$/.test(tok)) words++;
    if (words >= wordsPerChunk) {
      chunks.push(cur);
      cur = "";
      words = 0;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one assistant turn as an async generator: PLAN → EXECUTE tools (yielding
 * each card as it completes) → COMPOSE (yielding the reply progressively) → DONE.
 * Everything is persisted; the streaming route and the plain server action both
 * consume this single source of truth.
 */
export async function* runAssistantTurn(
  ctx: WorkspaceContext,
  threadId: string,
  userText: string,
  opts: { stream?: boolean } = {},
): AsyncGenerator<TurnEvent> {
  requirePermission(ctx.member.role, "assistant:use");
  const text = userText.trim();
  if (!text) throw new Error("Message is empty");

  const thread = await prisma.assistantThread.findFirst({
    where: { id: threadId, workspaceId: ctx.workspace.id },
  });
  if (!thread) throw new Error("Thread not found");

  const userMessage = await prisma.assistantMessage.create({
    data: { workspaceId: ctx.workspace.id, threadId, role: "user", content: text, createdByUserId: ctx.userId },
  });
  const correlationId = userMessage.id;
  await audit(ctx, {
    action: "assistant.message.created",
    entity: "AssistantMessage",
    entityId: userMessage.id,
    correlationId,
  });
  yield { type: "user", message: serialize(userMessage, null) };

  if (thread.title === DEFAULT_TITLE) {
    await prisma.assistantThread.update({ where: { id: threadId }, data: { title: text.slice(0, 60) } });
  }

  const history = await prisma.assistantMessage.findMany({
    where: { threadId, workspaceId: ctx.workspace.id, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { role: true, content: true },
  });
  const visibleTools = getVisibleTools(ctx);
  const catalog = toCatalog(visibleTools);
  const verticalContext = getVertical(ctx.workspace.vertical)?.assistantContext;
  const conversationContext = await buildConversationContext(ctx, thread);

  const assistantMessage = await prisma.assistantMessage.create({
    data: { workspaceId: ctx.workspace.id, threadId, role: "assistant", content: "", status: "streaming" },
  });

  const blocks: CockpitBlock[] = [];
  const outcomes: RunToolOutcome[] = [];
  let replyText = "";
  let confidence: number | null = null;

  try {
    const plan = await runAITask(ctx, planAssistantTurnTask, {
      userMessage: text,
      history: history.reverse().map((h) => ({ role: h.role, content: h.content })),
      tools: catalog,
      verticalContext,
      context: conversationContext ?? undefined,
    });

    const exec: ToolExecutionContext = { ctx, threadId, correlationId };
    for (let i = 0; i < plan.data.toolCalls.length; i++) {
      const call = plan.data.toolCalls[i];
      const tool = getTool(ctx.workspace.vertical, call.tool);
      if (!tool) {
        const block: CockpitBlock = { type: "error", code: "unknown_tool", message: `Unknown tool "${call.tool}"`, toolName: call.tool };
        blocks.push(block);
        yield { type: "block", block };
        continue;
      }
      const outcome = await runTool(exec, tool, call.input, {
        messageId: assistantMessage.id,
        idempotencyKey: `${correlationId}:${i}`,
        requestedByUserId: ctx.userId,
      });
      outcomes.push(outcome);
      blocks.push(outcome.block);
      yield { type: "block", block: outcome.block };
    }

    if (plan.data.toolCalls.length === 0) {
      replyText = plan.data.reply;
      confidence = plan.confidence;
    } else {
      const toolResults: ComposeInput["toolResults"] = outcomes.map((o) => ({
        tool: o.block.type === "tool" ? o.block.toolName : o.title,
        title: o.title,
        ok: !o.error,
        summary: o.resultSummary,
        awaitingApproval: o.awaitingApproval,
        error: o.error ?? undefined,
      }));
      const composed = await runAITask(ctx, composeAssistantReplyTask, {
        userMessage: text,
        toolResults,
        verticalContext,
      });
      replyText = composed.data.reply;
      confidence = composed.data.confidence;
    }
  } catch (err) {
    replyText =
      "I hit an error while processing that and stopped. No external actions were taken. " +
      (err instanceof Error ? err.message : "");
    await prisma.assistantMessage.update({ where: { id: assistantMessage.id }, data: { status: "error" } });
  }

  // Stream the reply text progressively (only when streaming; no artificial delay otherwise).
  for (const chunk of chunkText(replyText)) {
    yield { type: "text", delta: chunk };
    if (opts.stream) await sleep(18);
  }

  const structuredContent: AssistantStructuredContent = { blocks };
  const finalized = await prisma.assistantMessage.update({
    where: { id: assistantMessage.id },
    data: {
      content: replyText,
      structuredContent: structuredContent as object,
      confidence,
      status: blocks.some((b) => b.type === "error") && !replyText ? "error" : "complete",
    },
  });
  await prisma.assistantThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
  await audit(ctx, {
    action: "assistant.message.created",
    entity: "AssistantMessage",
    entityId: finalized.id,
    correlationId,
    after: { tools: outcomes.map((o) => o.title) },
  });
  yield { type: "done", message: serialize(finalized, "Operanto") };
}

/** Non-streaming turn: drains the generator. Used by the launcher / command bar. */
export async function sendAssistantMessage(ctx: WorkspaceContext, threadId: string, userText: string) {
  let userMessage: TurnMessage | undefined;
  let assistantMessage: TurnMessage | undefined;
  for await (const ev of runAssistantTurn(ctx, threadId, userText)) {
    if (ev.type === "user") userMessage = ev.message;
    if (ev.type === "done") assistantMessage = ev.message;
  }
  return { userMessage, assistantMessage };
}
