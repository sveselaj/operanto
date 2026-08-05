"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAllowingEnrolment } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import {
  beginTwoFactorEnrolment,
  beginTwoFactorRotation,
  cancelTwoFactorRotation,
  confirmTwoFactorEnrolment,
  confirmTwoFactorRotation,
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
  const ctx = await requireOrgAllowingEnrolment();
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
  const ctx = await requireOrgAllowingEnrolment();
  try {
    const { recoveryCodes } = await confirmTwoFactorEnrolment(
      ctx.user.id,
      String(formData.get("token") ?? ""),
    );
    await audit(ctx, {
      eventType: "user.two_factor_enabled",
      targetType: "User",
      targetId: ctx.user.id,
    });
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
  const ctx = await requireOrgAllowingEnrolment();
  try {
    await disableTwoFactor(
      ctx.user.id,
      String(formData.get("token") ?? ""),
      ctx.membership.role,
    );
    await audit(ctx, {
      eventType: "user.two_factor_disabled",
      targetType: "User",
      targetId: ctx.user.id,
    });
    revalidatePath("/settings/security");
    return { done: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not turn off" };
  }
}

/**
 * Rotation: replace an active authenticator (lost, shared or compromised)
 * without ever turning 2FA off — the only path available to roles that may
 * not disable it at all.
 */
export async function beginRotationAction(
  _prev: EnrolmentState | null,
  formData: FormData,
): Promise<EnrolmentState> {
  const ctx = await requireOrgAllowingEnrolment();
  try {
    const { secret, uri } = await beginTwoFactorRotation(
      ctx.user.id,
      String(formData.get("token") ?? ""),
    );
    return { secret, uri };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start rotation" };
  }
}

export async function confirmRotationAction(
  _prev: EnrolmentState | null,
  formData: FormData,
): Promise<EnrolmentState> {
  const ctx = await requireOrgAllowingEnrolment();
  try {
    const { recoveryCodes } = await confirmTwoFactorRotation(
      ctx.user.id,
      String(formData.get("token") ?? ""),
    );
    await audit(ctx, {
      eventType: "user.two_factor_rotated",
      targetType: "User",
      targetId: ctx.user.id,
    });
    revalidatePath("/settings/security");
    return { recoveryCodes, done: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Rotation failed" };
  }
}

export async function cancelRotationAction(): Promise<void> {
  const ctx = await requireOrgAllowingEnrolment();
  await cancelTwoFactorRotation(ctx.user.id);
  revalidatePath("/settings/security");
}
