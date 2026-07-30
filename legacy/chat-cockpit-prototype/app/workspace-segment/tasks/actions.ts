"use server";

import { revalidatePath } from "next/cache";
import type { Priority, TaskStatus } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as tasks from "@/lib/services/tasks";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(e: unknown): string {
  if (e instanceof ForbiddenError) return "You don't have permission to do that.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

async function ctxOrThrow(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx) throw new Error("Not authorized for this workspace");
  return ctx;
}

function revalidate(slug: string) {
  revalidatePath(`/${slug}/tasks`);
  revalidatePath(`/${slug}/command`);
}

export type CreateTaskFields = {
  title: string;
  description?: string;
  priority?: Priority;
  assignedToUserId?: string | null;
  dueAt?: string | null;
  linkedConversationId?: string | null;
  linkedCustomerId?: string | null;
};

export async function createTaskAction(
  slug: string,
  fields: CreateTaskFields,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await tasks.createTask(ctx, {
      title: fields.title,
      description: fields.description,
      priority: fields.priority,
      assignedToUserId: fields.assignedToUserId ?? null,
      dueAt: fields.dueAt ? new Date(fields.dueAt) : null,
      linkedConversationId: fields.linkedConversationId ?? null,
      linkedCustomerId: fields.linkedCustomerId ?? null,
    });
    revalidate(slug);
    if (fields.linkedConversationId)
      revalidatePath(`/${slug}/inbox/${fields.linkedConversationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export type UpdateTaskFields = {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  assignedToUserId?: string | null;
  dueAt?: string | null;
};

export async function updateTaskAction(
  slug: string,
  id: string,
  fields: UpdateTaskFields,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await tasks.updateTask(ctx, id, {
      ...fields,
      dueAt: fields.dueAt === undefined ? undefined : fields.dueAt ? new Date(fields.dueAt) : null,
    });
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
