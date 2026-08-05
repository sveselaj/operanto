"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/services/crm/notifications";

/**
 * Notification actions are self-scoped by the service: an id from the client
 * can only ever match the caller's own rows, so no extra permission applies.
 */
export async function markReadAction(formData: FormData) {
  const ctx = await requireOrg();
  await markNotificationRead(ctx, String(formData.get("id") ?? ""));
  revalidatePath("/notifications");
}

export async function markAllReadAction() {
  const ctx = await requireOrg();
  await markAllNotificationsRead(ctx);
  revalidatePath("/notifications");
}

export async function dismissAction(formData: FormData) {
  const ctx = await requireOrg();
  await dismissNotification(ctx, String(formData.get("id") ?? ""));
  revalidatePath("/notifications");
}
