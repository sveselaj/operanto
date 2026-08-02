"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import {
  addConversationNote,
  addManualMessage,
  assignConversation,
  changeConversationPriority,
  changeConversationStatus,
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  linkConversationCustomer,
  unlinkConversationCustomer,
} from "@/lib/services/conversations";
import { createTask, setTaskStatus } from "@/lib/services/tasks";

export type ComposerResult = { error: string } | { ok: true } | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/**
 * Quick controls (status/priority/assign/link) are plain form posts; failures
 * surface as a banner on the detail page via the `error` search param instead
 * of an error boundary or a browser alert.
 */
async function runControl(conversationId: string, fn: () => Promise<unknown>) {
  let failure: string | null = null;
  try {
    await fn();
  } catch (error) {
    failure = errorMessage(error);
  }
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/conversations");
  if (failure) {
    redirect(`/conversations/${conversationId}?error=${encodeURIComponent(failure)}`);
  }
}

export async function changeStatusAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  const statusRaw = String(formData.get("status") ?? "");
  const status = CONVERSATION_STATUSES.find((s) => s === statusRaw);
  if (!id || !status) return;
  await runControl(id, () => changeConversationStatus(ctx, id, status));
}

export async function changePriorityAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  const priorityRaw = String(formData.get("priority") ?? "");
  const priority = CONVERSATION_PRIORITIES.find((p) => p === priorityRaw);
  if (!id || !priority) return;
  await runControl(id, () => changeConversationPriority(ctx, id, priority));
}

export async function assignAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!id) return;
  await runControl(id, () => assignConversation(ctx, id, membershipId || null));
}

export async function linkCustomerAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  if (!id || !customerId) return;
  await runControl(id, () => linkConversationCustomer(ctx, id, customerId));
}

export async function unlinkCustomerAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  if (!id) return;
  await runControl(id, () => unlinkConversationCustomer(ctx, id));
}

export async function createTaskFromConversationAction(formData: FormData) {
  const ctx = await requireOrg();
  const conversationId = String(formData.get("conversationId") ?? "");
  const title = String(formData.get("title") ?? "");
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const assignedMembershipId = String(formData.get("assignedMembershipId") ?? "");
  if (!conversationId || !title.trim()) return;
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : undefined;
  await runControl(conversationId, () =>
    createTask(ctx, {
      title,
      conversationId,
      assignedMembershipId: assignedMembershipId || undefined,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : undefined,
    }),
  );
}

export async function toggleConversationTaskAction(formData: FormData) {
  const ctx = await requireOrg();
  const conversationId = String(formData.get("conversationId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");
  if (!conversationId || !taskId) return;
  if (nextStatus !== "OPEN" && nextStatus !== "COMPLETED") return;
  await runControl(conversationId, () => setTaskStatus(ctx, taskId, nextStatus));
}

export async function addMessageAction(
  _prev: ComposerResult,
  formData: FormData,
): Promise<ComposerResult> {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "");
  try {
    await addManualMessage(ctx, id, body);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  return { ok: true };
}

export async function addNoteAction(
  _prev: ComposerResult,
  formData: FormData,
): Promise<ComposerResult> {
  const ctx = await requireOrg();
  const id = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "");
  try {
    await addConversationNote(ctx, id, body);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(`/conversations/${id}`);
  return { ok: true };
}
