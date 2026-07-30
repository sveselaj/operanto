"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import {
  retryEvent,
  rotateWebhookSecret,
  setIntegrationStatus,
  upsertStaffMapping,
} from "@/lib/services/integrations";

export async function retryEventAction(formData: FormData) {
  const ctx = await requireOrg();
  await retryEvent(ctx, String(formData.get("eventId") ?? ""));
  revalidatePath("/integrations/pronatona");
}

export async function setStatusAction(formData: FormData) {
  const ctx = await requireOrg();
  const status = String(formData.get("status") ?? "");
  if (status !== "ACTIVE" && status !== "DISABLED") return;
  await setIntegrationStatus(ctx, String(formData.get("integrationId") ?? ""), status);
  revalidatePath("/integrations/pronatona");
}

export async function rotateSecretAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const ctx = await requireOrg();
  try {
    await rotateWebhookSecret(
      ctx,
      String(formData.get("integrationId") ?? ""),
      String(formData.get("newSecret") ?? ""),
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Rotation failed";
  }
  revalidatePath("/integrations/pronatona");
  return "Secret rotated. Update OPERANTO_WEBHOOK_SECRET on the Pronatona side to match.";
}

export async function upsertStaffMappingAction(formData: FormData) {
  const ctx = await requireOrg();
  const sourceStaffId = String(formData.get("sourceStaffId") ?? "").trim();
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!sourceStaffId || !membershipId) return;
  await upsertStaffMapping(ctx, {
    sourceSystem: "PRONATONA_WEB",
    sourceStaffId,
    membershipId,
  });
  revalidatePath("/integrations/pronatona");
}
