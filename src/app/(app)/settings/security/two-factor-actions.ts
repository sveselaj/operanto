"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import {
  beginTwoFactorEnrolment,
  confirmTwoFactorEnrolment,
  disableTwoFactor,
} from "@/lib/services/two-factor";

export type EnrolmentState = {
  secret?: string;
  uri?: string;
  recoveryCodes?: string[];
  error?: string;
  done?: boolean;
};

export async function beginEnrolmentAction(): Promise<EnrolmentState> {
  const ctx = await requireOrg();
  try {
    return await beginTwoFactorEnrolment(ctx.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start enrolment" };
  }
}

export async function confirmEnrolmentAction(
  _prev: EnrolmentState | null,
  formData: FormData,
): Promise<EnrolmentState> {
  const ctx = await requireOrg();
  try {
    const { recoveryCodes } = await confirmTwoFactorEnrolment(
      ctx.user.id,
      String(formData.get("token") ?? ""),
    );
    revalidatePath("/settings/security");
    return { recoveryCodes, done: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Confirmation failed" };
  }
}

export async function disableTwoFactorAction(
  _prev: EnrolmentState | null,
  formData: FormData,
): Promise<EnrolmentState> {
  const ctx = await requireOrg();
  try {
    await disableTwoFactor(ctx.user.id, String(formData.get("token") ?? ""));
    revalidatePath("/settings/security");
    return { done: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not turn off" };
  }
}
