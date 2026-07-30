"use server";

import { revalidatePath } from "next/cache";
import type { OpportunityStage } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import {
  addOpportunityNote,
  assignOpportunity,
  OPPORTUNITY_STAGES,
  updateOpportunityStage,
} from "@/lib/services/opportunities";
import { createTask, setTaskStatus } from "@/lib/services/tasks";

export async function updateStageAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("opportunityId") ?? "");
  const stage = String(formData.get("stage") ?? "") as OpportunityStage;
  if (!OPPORTUNITY_STAGES.includes(stage)) return;
  await updateOpportunityStage(ctx, id, stage);
  revalidatePath(`/opportunities/${id}`);
}

export async function assignAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("opportunityId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  await assignOpportunity(ctx, id, membershipId || null);
  revalidatePath(`/opportunities/${id}`);
}

export async function addNoteAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("opportunityId") ?? "");
  const body = String(formData.get("body") ?? "");
  if (!body.trim()) return;
  await addOpportunityNote(ctx, id, body);
  revalidatePath(`/opportunities/${id}`);
}

export async function createTaskAction(formData: FormData) {
  const ctx = await requireOrg();
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const title = String(formData.get("title") ?? "");
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const assignedMembershipId = String(formData.get("assignedMembershipId") ?? "");
  if (!title.trim()) return;
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : undefined;
  await createTask(ctx, {
    title,
    opportunityId,
    assignedMembershipId: assignedMembershipId || undefined,
    dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : undefined,
  });
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function toggleTaskAction(formData: FormData) {
  const ctx = await requireOrg();
  const taskId = String(formData.get("taskId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");
  if (nextStatus !== "OPEN" && nextStatus !== "COMPLETED") return;
  await setTaskStatus(ctx, taskId, nextStatus);
  revalidatePath(`/opportunities/${opportunityId}`);
}
