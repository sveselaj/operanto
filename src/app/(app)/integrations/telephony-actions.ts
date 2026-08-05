"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import {
  connectTelephony,
  disableTelephonyConnection,
  setTelephonyStageGates,
} from "@/lib/services/telephony";

export interface ConnectTelephonyState {
  ok?: boolean;
  error?: string;
  /** Shown exactly once after a successful connect. */
  webhookSecret?: string;
  connectionId?: string;
}

export async function connectTelephonyAction(
  _prev: ConnectTelephonyState,
  formData: FormData,
): Promise<ConnectTelephonyState> {
  const ctx = await requireOrg();
  try {
    const result = await connectTelephony(ctx, {
      provider: String(formData.get("provider") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      apiKey: String(formData.get("apiKey") ?? "") || undefined,
      apiSecret: String(formData.get("apiSecret") ?? "") || undefined,
      accountRef: String(formData.get("accountRef") ?? "") || undefined,
    });
    revalidatePath("/integrations");
    return { ok: true, webhookSecret: result.webhookSecret, connectionId: result.connectionId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Connection failed" };
  }
}

export async function setTelephonyGatesAction(formData: FormData) {
  const ctx = await requireOrg();
  await setTelephonyStageGates(ctx, String(formData.get("connectionId") ?? ""), {
    inboundEnabled: formData.get("inboundEnabled") === "1",
    outboundEnabled: formData.get("outboundEnabled") === "1",
  });
  revalidatePath("/integrations");
}

export async function disableTelephonyAction(formData: FormData) {
  const ctx = await requireOrg();
  await disableTelephonyConnection(ctx, String(formData.get("connectionId") ?? ""));
  revalidatePath("/integrations");
}
