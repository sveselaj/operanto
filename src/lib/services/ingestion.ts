import "server-only";
import type { Conversation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAutomationsForConversation } from "@/lib/services/automations";
import type { NormalizedInbound } from "@/lib/channels";
import { resolveCustomer } from "@/lib/mediasync/identity";
import { applyInboundConsentSignal } from "@/lib/mediasync/consent";

export type IngestResult = {
  conversationId: string;
  customerId: string;
  created: boolean; // whether a new conversation was created
  duplicate?: boolean; // true when the inbound was already ingested (idempotent skip)
};

/**
 * Ingest a normalized inbound message (MediaSync intake): resolve the channel
 * account (which determines the workspace), resolve customer identity, find-or-
 * create an open conversation, append the message idempotently, honor consent
 * keywords, and fire automations.
 *
 * Runs with workspace authority (no logged-in user) — appropriate for webhooks.
 */
export async function ingestInbound(input: NormalizedInbound): Promise<IngestResult> {
  if (!input.channelAccountId) throw new Error("channelAccountId is required");
  const channelAccount = await prisma.channelAccount.findUnique({
    where: { id: input.channelAccountId },
    include: { workspace: { select: { defaultCountryCode: true } } },
  });
  if (!channelAccount) throw new Error("Unknown channel account");

  const workspaceId = channelAccount.workspaceId;

  // ── Identity resolution (cross-channel match / create) ──
  const customer = await resolveCustomer(workspaceId, input.customer, {
    channelType: channelAccount.type,
    defaultCountryCode: channelAccount.workspace?.defaultCountryCode,
  });

  // ── Idempotency: a provider may retry the same event ──
  if (input.externalMessageId) {
    const seen = await prisma.message.findFirst({
      where: { workspaceId, externalMessageId: input.externalMessageId },
      select: { id: true, conversationId: true },
    });
    if (seen) {
      return {
        conversationId: seen.conversationId,
        customerId: customer.id,
        created: false,
        duplicate: true,
      };
    }
  }

  // ── Find an active conversation on this channel, else create one ──
  let conversation: Conversation | null = await prisma.conversation.findFirst({
    where: {
      workspaceId,
      customerId: customer.id,
      channelAccountId: channelAccount.id,
      status: { in: ["open", "pending", "waiting_customer"] },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const created = !conversation;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        customerId: customer.id,
        channelAccountId: channelAccount.id,
        channelType: channelAccount.type,
        status: "open",
        priority: "normal",
      },
    });
  }

  const now = new Date();
  await prisma.message.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      direction: "inbound",
      senderType: "customer",
      body: input.body,
      externalMessageId: input.externalMessageId ?? null,
      status: "delivered", // inbound: it reached us
      statusUpdatedAt: now,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now, lastInboundAt: now, status: "open" },
  });

  // ── Honor STOP/START consent keywords ──
  const consentChange = await applyInboundConsentSignal(
    workspaceId,
    customer.id,
    channelAccount.type,
    input.body,
  );

  await prisma.auditLog.create({
    data: {
      workspaceId,
      action: "message.ingest",
      entity: "Conversation",
      entityId: conversation.id,
      after: { channel: channelAccount.type, created, consentChange },
    },
  });

  // ── Fire automations (system context: no user) ──
  const run = { workspaceId, actorUserId: null };
  if (created) {
    await runAutomationsForConversation(run, "conversation_created", conversation.id, input.body);
  }
  await runAutomationsForConversation(run, "inbound_message", conversation.id, input.body);

  return { conversationId: conversation.id, customerId: customer.id, created };
}
