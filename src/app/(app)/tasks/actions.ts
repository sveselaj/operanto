"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import { setTaskStatus } from "@/lib/services/tasks";

export async function toggleTaskFromListAction(formData: FormData) {
  const ctx = await requireOrg();
  const taskId = String(formData.get("taskId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");
  if (nextStatus !== "OPEN" && nextStatus !== "COMPLETED") return;
  await setTaskStatus(ctx, taskId, nextStatus);
  revalidatePath("/tasks");
}
