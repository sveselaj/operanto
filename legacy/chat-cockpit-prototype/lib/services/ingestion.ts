import "server-only";
import type { Conversation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAutomationsForConversation } from "@/lib/services/automations";
import type { NormalizedInbound } from "@/lib/channels";

export type IngestResult = {
  conversationId: string;
  customerId: string;
  created: boolean; // whether a new conversation was created
};

/**
 * Ingest a normalized inbound message: resolve the channel account (which
 * determines the workspace), upsert the customer, find-or-create an open
 * conversation, append the message, and fire automations.
 *
 * Runs with workspace authority (no logged-in user) — appropriate for webhooks.
 */
export async function ingestInbound(input: NormalizedInbound): Promise<IngestResult> {
  const channelAccount = await prisma.channelAccount.findUnique({
    where: { id: input.channelAccountId },
  });
  if (!channelAccount) throw new Error("Unknown channel account");

  const workspaceId = channelAccount.workspaceId;
  const c = input.customer;

  // ── Resolve / create the customer (scoped to the workspace) ──
  let customer = await findCustomer(workspaceId, c);
  if (!customer) {
    const socialHandles: Record<string, string> = {};
    if (c.handle) socialHandles[channelAccount.type] = c.handle;
    if (c.externalId) socialHandles.externalId = c.externalId;

    customer = await prisma.customer.create({
      data: {
        workspaceId,
        name: c.name ?? c.handle ?? "Website visitor",
        email: c.email ?? null,
        phone: c.phone ?? null,
        socialHandles: Object.keys(socialHandles).length ? socialHandles : undefined,
      },
    });
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
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now, lastInboundAt: now, status: "open" },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId,
      action: "message.ingest",
      entity: "Conversation",
      entityId: conversation.id,
      after: { channel: channelAccount.type, created },
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

async function findCustomer(
  workspaceId: string,
  c: NormalizedInbound["customer"],
) {
  const or: object[] = [];
  if (c.email) or.push({ email: c.email });
  if (c.phone) or.push({ phone: c.phone });
  if (c.externalId) or.push({ socialHandles: { path: ["externalId"], equals: c.externalId } });
  if (or.length === 0) return null;
  return prisma.customer.findFirst({ where: { workspaceId, OR: or } });
}
