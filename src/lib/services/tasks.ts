import "server-only";
import type { Prisma, TaskPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { opportunityAccessWhere } from "@/lib/services/opportunities";
import { conversationAccessWhere } from "@/lib/services/conversations";

export function taskAccessWhere(ctx: OrgContext): Prisma.TaskWhereInput {
  if (can(ctx.membership.role, "opportunities:view_all")) return scope(ctx);
  return {
    ...scope(ctx),
    OR: [
      { assignedMembershipId: ctx.membership.id },
      { createdByMembershipId: ctx.membership.id },
      { opportunity: { assignedMembershipId: ctx.membership.id } },
      { conversation: { assignedMembershipId: ctx.membership.id } },
    ],
  };
}

export type TaskFilter = {
  status?: "OPEN" | "COMPLETED";
  assignedMembershipId?: string;
  overdue?: boolean;
  dueBefore?: Date;
};

export async function listTasks(ctx: OrgContext, filter: TaskFilter = {}) {
  requirePermission(ctx.membership.role, "tasks:manage");
  return prisma.task.findMany({
    where: {
      ...taskAccessWhere(ctx),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.assignedMembershipId
        ? { assignedMembershipId: filter.assignedMembershipId }
        : {}),
      ...(filter.overdue ? { status: "OPEN", dueAt: { lt: new Date() } } : {}),
      ...(filter.dueBefore ? { dueAt: { lte: filter.dueBefore } } : {}),
    },
    include: {
      assignee: { include: { user: { select: { name: true } } } },
      opportunity: {
        select: {
          id: true,
          summary: true,
          customer: { select: { id: true, name: true } },
        },
      },
      conversation: {
        select: {
          id: true,
          subject: true,
          customer: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function createTask(
  ctx: OrgContext,
  input: {
    title: string;
    description?: string;
    opportunityId?: string;
    conversationId?: string;
    assignedMembershipId?: string;
    priority?: TaskPriority;
    dueAt?: Date;
  },
) {
  requirePermission(ctx.membership.role, "tasks:manage");
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("Title must be 1–200 characters");

  if (input.opportunityId) {
    const opportunity = await prisma.opportunity.findFirst({
      where: { ...opportunityAccessWhere(ctx), id: input.opportunityId },
      select: { id: true },
    });
    if (!opportunity) throw new Error("Opportunity not found");
  }
  let conversationCustomerId: string | null = null;
  if (input.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { ...conversationAccessWhere(ctx), id: input.conversationId },
      select: { id: true, customer: { select: { id: true, restrictedAt: true } } },
    });
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.customer?.restrictedAt) {
      // Restriction of processing halts new follow-up work, not just messages.
      throw new Error(
        "Processing for this customer is restricted (GDPR Art. 18) — no new follow-up work may be created",
      );
    }
    conversationCustomerId = conversation.customer?.id ?? null;
  }
  if (input.assignedMembershipId) {
    const member = await prisma.membership.findFirst({
      where: { id: input.assignedMembershipId, ...scope(ctx), status: "ACTIVE" },
    });
    if (!member) throw new Error("Assignee is not an active member of this organisation");
  }

  const task = await prisma.task.create({
    data: {
      organisationId: ctx.organisation.id,
      opportunityId: input.opportunityId ?? null,
      conversationId: input.conversationId ?? null,
      assignedMembershipId: input.assignedMembershipId ?? null,
      createdByMembershipId: ctx.membership.id,
      title,
      description: input.description?.trim() || null,
      priority: input.priority ?? "NORMAL",
      dueAt: input.dueAt ?? null,
    },
  });
  if (input.opportunityId || input.conversationId) {
    await prisma.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        opportunityId: input.opportunityId ?? null,
        conversationId: input.conversationId ?? null,
        customerId: conversationCustomerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "task.created",
        summary: `Task created: ${title}`,
        metadata: { taskId: task.id },
      },
    });
  }
  // Ids only: task titles are free text that staff fill with personal data
  // (erasure redacts them for exactly that reason), and audit rows outlive
  // both retention and erasure.
  await audit(ctx, {
    eventType: "task.created",
    targetType: "Task",
    targetId: task.id,
    after: {
      opportunityId: input.opportunityId ?? null,
      conversationId: input.conversationId ?? null,
      assignedMembershipId: input.assignedMembershipId ?? null,
    },
  });
  return task;
}

export async function setTaskStatus(
  ctx: OrgContext,
  id: string,
  status: "OPEN" | "COMPLETED",
) {
  requirePermission(ctx.membership.role, "tasks:manage");
  const existing = await prisma.task.findFirst({
    where: { ...taskAccessWhere(ctx), id },
    include: { conversation: { select: { customerId: true } } },
  });
  if (!existing) throw new Error("Task not found");
  if (existing.status === status) return existing;

  const task = await prisma.task.update({
    where: { id: existing.id },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });
  if (existing.opportunityId || existing.conversationId) {
    await prisma.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        opportunityId: existing.opportunityId,
        conversationId: existing.conversationId,
        customerId: existing.conversation?.customerId ?? null,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: status === "COMPLETED" ? "task.completed" : "task.reopened",
        summary: `${status === "COMPLETED" ? "Completed" : "Reopened"}: ${existing.title}`,
        metadata: { taskId: existing.id },
      },
    });
  }
  await audit(ctx, {
    eventType: status === "COMPLETED" ? "task.completed" : "task.reopened",
    targetType: "Task",
    targetId: existing.id,
  });
  return task;
}
