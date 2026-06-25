import "server-only";
import type {
  ConversationStatus,
  Priority,
  ChannelType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { canSend } from "@/lib/mediasync/consent";
import { getChannelCredentials } from "@/lib/mediasync/channel-credentials";
import { getConnector } from "@/lib/channels";
import type { MessageStatus } from "@prisma/client";

export type ConversationFilters = {
  status?: ConversationStatus | "all";
  channel?: ChannelType | "all";
  q?: string;
  assignee?: string | "me" | "unassigned" | "all";
};

/** List conversations for the inbox, newest activity first. */
export async function listConversations(
  ctx: WorkspaceContext,
  filters: ConversationFilters = {},
) {
  requirePermission(ctx.member.role, "conversations:read");

  const where: Prisma.ConversationWhereInput = { workspaceId: ctx.workspace.id };

  if (filters.status && filters.status !== "all") where.status = filters.status;
  if (filters.channel && filters.channel !== "all") where.channelType = filters.channel;

  if (filters.assignee === "me") where.assignedToUserId = ctx.userId;
  else if (filters.assignee === "unassigned") where.assignedToUserId = null;
  else if (filters.assignee && filters.assignee !== "all")
    where.assignedToUserId = filters.assignee;

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return prisma.conversation.findMany({
    where,
    include: {
      customer: true,
      assignedTo: true,
      tags: { include: { tag: true } },
    },
    orderBy: [{ priority: "desc" }, { lastMessageAt: "desc" }],
    take: 100,
  });
}

/** Counts per status for the filter tabs. */
export async function conversationStatusCounts(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "conversations:read");
  const grouped = await prisma.conversation.groupBy({
    by: ["status"],
    where: { workspaceId: ctx.workspace.id },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    total += g._count._all;
  }
  counts.all = total;
  return counts;
}

/** Full conversation for the detail view, scoped to the workspace. */
export async function getConversation(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "conversations:read");
  return prisma.conversation.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: {
      customer: { include: { consents: true } },
      assignedTo: true,
      channelAccount: true,
      tags: { include: { tag: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: true },
      },
      internalNotes: {
        orderBy: { createdAt: "asc" },
        include: { user: true },
      },
    },
  });
}

/** Ensure a conversation belongs to the active workspace before mutating. */
async function assertConversation(ctx: WorkspaceContext, id: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: {
      id: true,
      status: true,
      priority: true,
      assignedToUserId: true,
      customerId: true,
      channelType: true,
      channelAccountId: true,
    },
  });
  if (!conv) throw new Error("Conversation not found");
  return conv;
}

type ChannelTypeOf = Awaited<ReturnType<typeof assertConversation>>["channelType"];

/** Resolve the outbound address for a customer on a given channel. */
function recipientFor(
  customer: { phone: string | null; phoneNormalized: string | null; socialHandles: unknown },
  channelType: ChannelTypeOf,
): string | null {
  const handles = (customer.socialHandles as Record<string, string> | null) ?? {};
  switch (channelType) {
    case "whatsapp":
    case "sms":
    case "viber": {
      const phone = customer.phoneNormalized ?? customer.phone;
      return phone ? phone.replace(/^\+/, "") : null; // providers want digits
    }
    case "facebook":
    case "instagram":
    case "telegram":
      return handles.externalId ?? null;
    default:
      return null;
  }
}

export async function sendReply(ctx: WorkspaceContext, id: string, body: string) {
  requirePermission(ctx.member.role, "conversations:reply");
  const conv = await assertConversation(ctx, id);
  const text = body.trim();
  if (!text) throw new Error("Message is empty");

  // MediaSync consent gate: never send to a customer who opted out of this channel.
  if (conv.customerId) {
    const gate = await canSend(ctx.workspace.id, conv.customerId, conv.channelType);
    if (!gate.ok) throw new Error(gate.reason ?? "Customer has opted out of this channel");
  }

  // Web chat / manual deliver in-app immediately. Provider channels attempt a
  // real send through the connector when configured; otherwise the message is
  // recorded as "sent" (a delivery-status webhook later advances it).
  const inApp = conv.channelType === "webchat" || conv.channelType === "manual";
  let status: MessageStatus = inApp ? "delivered" : "sent";
  let externalMessageId: string | null = null;
  let errorMessage: string | null = null;

  if (!inApp && conv.channelAccountId && conv.customerId) {
    const connector = getConnector(conv.channelType);
    const creds = (await getChannelCredentials(ctx.workspace.id, conv.channelAccountId)) ?? undefined;
    if (connector.isConfigured(creds)) {
      const customer = await prisma.customer.findUnique({
        where: { id: conv.customerId },
        select: { phone: true, phoneNormalized: true, socialHandles: true },
      });
      const to = customer ? recipientFor(customer, conv.channelType) : null;
      if (!to) {
        status = "failed";
        errorMessage = `No ${conv.channelType} address on file for this customer.`;
      } else {
        try {
          const res = await connector.sendMessage(to, text, creds);
          externalMessageId = res.externalMessageId ?? null;
          status = "sent";
        } catch (e) {
          status = "failed";
          errorMessage = e instanceof Error ? e.message : "Send failed";
        }
      }
    }
  }

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      workspaceId: ctx.workspace.id,
      conversationId: id,
      direction: "outbound",
      senderType: "agent",
      senderUserId: ctx.userId,
      body: text,
      status,
      statusUpdatedAt: now,
      externalMessageId,
      errorMessage,
    },
  });
  // Sending implicitly puts a human in control of the conversation.
  await prisma.conversation.update({
    where: { id },
    data: { lastMessageAt: now, lastOutboundAt: now, handling: "human" },
  });
  await audit(ctx, { action: "conversation.reply", entity: "Message", entityId: message.id });
  return message;
}

export async function updateStatus(
  ctx: WorkspaceContext,
  id: string,
  status: ConversationStatus,
) {
  requirePermission(ctx.member.role, "conversations:triage");
  const before = await assertConversation(ctx, id);
  await prisma.conversation.update({ where: { id }, data: { status } });
  await audit(ctx, {
    action: "conversation.status",
    entity: "Conversation",
    entityId: id,
    before: { status: before.status },
    after: { status },
  });
}

export async function updatePriority(ctx: WorkspaceContext, id: string, priority: Priority) {
  requirePermission(ctx.member.role, "conversations:triage");
  const before = await assertConversation(ctx, id);
  await prisma.conversation.update({ where: { id }, data: { priority } });
  await audit(ctx, {
    action: "conversation.priority",
    entity: "Conversation",
    entityId: id,
    before: { priority: before.priority },
    after: { priority },
  });
}

export async function assignConversation(
  ctx: WorkspaceContext,
  id: string,
  userId: string | null,
) {
  requirePermission(ctx.member.role, "conversations:triage");
  const before = await assertConversation(ctx, id);

  // Assignee must be a member of this workspace.
  if (userId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId } },
    });
    if (!member) throw new Error("Assignee is not a member of this workspace");
  }

  await prisma.conversation.update({ where: { id }, data: { assignedToUserId: userId } });
  await audit(ctx, {
    action: "conversation.assign",
    entity: "Conversation",
    entityId: id,
    before: { assignedToUserId: before.assignedToUserId },
    after: { assignedToUserId: userId },
  });
}

export async function addNote(ctx: WorkspaceContext, id: string, body: string) {
  requirePermission(ctx.member.role, "conversations:read");
  await assertConversation(ctx, id);
  const text = body.trim();
  if (!text) throw new Error("Note is empty");
  const note = await prisma.internalNote.create({
    data: {
      workspaceId: ctx.workspace.id,
      conversationId: id,
      userId: ctx.userId,
      body: text,
    },
    include: { user: true },
  });
  await audit(ctx, { action: "conversation.note", entity: "InternalNote", entityId: note.id });
  return note;
}

export async function setTags(ctx: WorkspaceContext, id: string, tagIds: string[]) {
  requirePermission(ctx.member.role, "conversations:triage");
  await assertConversation(ctx, id);

  // Only tags belonging to this workspace.
  const validTags = await prisma.tag.findMany({
    where: { id: { in: tagIds }, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  const validIds = validTags.map((t) => t.id);

  await prisma.$transaction([
    prisma.conversationTag.deleteMany({ where: { conversationId: id } }),
    prisma.conversationTag.createMany({
      data: validIds.map((tagId) => ({ conversationId: id, tagId })),
    }),
  ]);
  await audit(ctx, {
    action: "conversation.tags",
    entity: "Conversation",
    entityId: id,
    after: { tagIds: validIds },
  });
}

/** Members eligible for assignment (those who can reply/triage). */
export async function listAssignableMembers(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "conversations:read");
  return prisma.workspaceMember.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      status: "active",
      role: { in: ["owner", "admin", "manager", "agent"] },
    },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listWorkspaceTags(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "conversations:read");
  return prisma.tag.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { name: "asc" },
  });
}
