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
      customer: true,
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
    select: { id: true, status: true, priority: true, assignedToUserId: true },
  });
  if (!conv) throw new Error("Conversation not found");
  return conv;
}

export async function sendReply(ctx: WorkspaceContext, id: string, body: string) {
  requirePermission(ctx.member.role, "conversations:reply");
  await assertConversation(ctx, id);
  const text = body.trim();
  if (!text) throw new Error("Message is empty");

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      workspaceId: ctx.workspace.id,
      conversationId: id,
      direction: "outbound",
      senderType: "agent",
      senderUserId: ctx.userId,
      body: text,
    },
  });
  await prisma.conversation.update({
    where: { id },
    data: { lastMessageAt: now, lastOutboundAt: now },
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
