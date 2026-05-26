import "server-only";
import type { TaskStatus, Priority, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";

export type TaskFilters = {
  assignee?: string | "me" | "all";
  status?: TaskStatus | "all";
};

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  priority?: Priority;
  assignedToUserId?: string | null;
  dueAt?: Date | null;
  linkedConversationId?: string | null;
  linkedCustomerId?: string | null;
  linkedSopId?: string | null;
};

export type UpdateTaskInput = Partial<{
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assignedToUserId: string | null;
  dueAt: Date | null;
}>;

export async function listTasks(ctx: WorkspaceContext, filters: TaskFilters = {}) {
  requirePermission(ctx.member.role, "tasks:manage");
  const where: Prisma.TaskWhereInput = { workspaceId: ctx.workspace.id };
  if (filters.status && filters.status !== "all") where.status = filters.status;
  if (filters.assignee === "me") where.assignedToUserId = ctx.userId;
  else if (filters.assignee && filters.assignee !== "all")
    where.assignedToUserId = filters.assignee;

  return prisma.task.findMany({
    where,
    include: {
      assignedTo: true,
      linkedConversation: { include: { customer: true } },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

async function assertMember(ctx: WorkspaceContext, userId: string | null | undefined) {
  if (!userId) return;
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId } },
  });
  if (!m) throw new Error("Assignee is not a member of this workspace");
}

export async function createTask(ctx: WorkspaceContext, input: CreateTaskInput) {
  requirePermission(ctx.member.role, "tasks:manage");
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  await assertMember(ctx, input.assignedToUserId);

  // Validate linked entities belong to this workspace.
  if (input.linkedConversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: input.linkedConversationId, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!conv) throw new Error("Linked conversation not found");
  }

  const task = await prisma.task.create({
    data: {
      workspaceId: ctx.workspace.id,
      title,
      description: input.description?.trim() || null,
      priority: input.priority ?? "normal",
      assignedToUserId: input.assignedToUserId ?? null,
      createdByUserId: ctx.userId,
      dueAt: input.dueAt ?? null,
      linkedConversationId: input.linkedConversationId ?? null,
      linkedCustomerId: input.linkedCustomerId ?? null,
      linkedSopId: input.linkedSopId ?? null,
    },
  });
  await audit(ctx, { action: "task.create", entity: "Task", entityId: task.id });
  return task;
}

export async function updateTask(ctx: WorkspaceContext, id: string, input: UpdateTaskInput) {
  requirePermission(ctx.member.role, "tasks:manage");
  const existing = await prisma.task.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!existing) throw new Error("Task not found");
  await assertMember(ctx, input.assignedToUserId);

  const data: Prisma.TaskUpdateInput = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueAt !== undefined) data.dueAt = input.dueAt;
  if (input.assignedToUserId !== undefined)
    data.assignedTo = input.assignedToUserId
      ? { connect: { id: input.assignedToUserId } }
      : { disconnect: true };

  const task = await prisma.task.update({ where: { id }, data });
  await audit(ctx, {
    action: "task.update",
    entity: "Task",
    entityId: id,
    before: { status: existing.status, priority: existing.priority },
    after: input,
  });
  return task;
}
