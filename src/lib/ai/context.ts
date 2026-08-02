import "server-only";
import { prisma } from "@/lib/prisma";
import type { OrgContext } from "@/lib/org-context";
import { conversationAccessWhere } from "@/lib/services/conversations";
import { AIError } from "@/lib/ai/types";
import type { ConversationAIInput } from "@/lib/ai/tasks";

/**
 * AI context builder: assembles the MINIMUM conversation context a task
 * needs, under the caller's record-level scope.
 *
 * Boundaries, by construction:
 * - strict organisation + record-level scoping (conversationAccessWhere);
 * - bounded content (last 20 messages, 5 notes, 5 tasks, 3 opportunities);
 * - restriction of processing blocks ALL AI tasks — mock and live alike —
 *   before any content is assembled;
 * - erased content arrives already redacted ("[erased]") and is passed as-is;
 * - no secrets, no audit records, no other customers, never the record graph.
 *
 * The returned content lives in request memory only. What may be persisted
 * about it is the PII-reduced descriptor from `describeInput` — counts and
 * flags, never bodies or names.
 */

const CHANNEL_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  SIMULATOR: "Simulator",
};

export async function buildConversationAIInput(
  ctx: OrgContext,
  conversationId: string,
): Promise<{
  input: ConversationAIInput;
  conversationId: string;
  customerId: string | null;
}> {
  const conversation = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          erasedAt: true,
          restrictedAt: true,
          preferredLanguage: true,
          channelIdentities: { take: 1, select: { externalId: true } },
          opportunities: {
            select: { summary: true },
            orderBy: { lastActivityAt: "desc" },
            take: 3,
          },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { direction: true, body: true },
      },
      notes: { orderBy: { createdAt: "desc" }, take: 5, select: { body: true } },
      tasks: {
        where: { status: "OPEN" },
        take: 5,
        select: { title: true },
      },
      participants: {
        where: { type: "CUSTOMER" },
        take: 1,
        select: { displayName: true },
      },
    },
  });
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.customer?.restrictedAt) {
    throw new AIError(
      "PROCESSING_RESTRICTED",
      "Processing for this customer is restricted (GDPR Art. 18) — AI assistance is blocked",
    );
  }

  const customer = conversation.customer;
  return {
    conversationId: conversation.id,
    customerId: customer?.id ?? null,
    input: {
      channelLabel:
        CHANNEL_LABELS[conversation.channelType] ?? conversation.channelType,
      subject: conversation.subject,
      status: conversation.status,
      priority: conversation.priority,
      customerName: customer?.erasedAt
        ? null
        : (customer?.name ?? conversation.participants[0]?.displayName ?? null),
      restrictedCustomer: false,
      messages: [...conversation.messages]
        .reverse()
        .map((m) => ({ direction: m.direction, body: m.body })),
      internalNotes: conversation.notes.map((n) => n.body),
      openTaskTitles: conversation.tasks.map((t) => t.title),
      opportunitySummaries: (customer?.opportunities ?? [])
        .map((o) => o.summary)
        .filter((s): s is string => Boolean(s)),
      knownChannelIdentity: customer?.channelIdentities[0]?.externalId ?? null,
      language: customer?.preferredLanguage ?? null,
    },
  };
}

/** PII-reduced input descriptor — the ONLY input detail AIAction persists. */
export function describeInput(input: ConversationAIInput): object {
  return {
    channelLabel: input.channelLabel,
    messageCount: input.messages.length,
    noteCount: input.internalNotes.length,
    openTaskCount: input.openTaskTitles.length,
    opportunityCount: input.opportunitySummaries.length,
    hasCustomer: input.customerName !== null,
    language: input.language,
  };
}
