"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import {
  connectWhatsApp,
  setWhatsAppStageGates,
  verifyWhatsAppConnection,
} from "@/lib/services/whatsapp-connection";

export type WhatsAppFormState = { error: string | null; notice: string | null };

export async function connectWhatsAppAction(
  _prev: WhatsAppFormState,
  formData: FormData,
): Promise<WhatsAppFormState> {
  const ctx = await requireOrg();
  try {
    const result = await connectWhatsApp(ctx, {
      wabaId: String(formData.get("wabaId") ?? ""),
      phoneNumberId: String(formData.get("phoneNumberId") ?? ""),
      displayPhoneNumber: String(formData.get("displayPhoneNumber") ?? ""),
      accessToken: String(formData.get("accessToken") ?? ""),
    });
    revalidatePath("/integrations");
    return {
      error: null,
      notice: result.verified
        ? "Connection saved and verified with the provider."
        : `Connection saved, but verification failed: ${result.detail ?? "unknown"}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Connection failed",
      notice: null,
    };
  }
}

export async function setStageGateAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  const connectionId = String(formData.get("connectionId") ?? "");
  const gate = String(formData.get("gate") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (gate !== "inbound" && gate !== "outbound") return;
  await setWhatsAppStageGates(ctx, connectionId, {
    ...(gate === "inbound" ? { inboundEnabled: enabled } : {}),
    ...(gate === "outbound" ? { outboundEnabled: enabled } : {}),
  });
  revalidatePath("/integrations");
}

export async function verifyConnectionAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  await verifyWhatsAppConnection(ctx, String(formData.get("connectionId") ?? ""));
  revalidatePath("/integrations");
}
