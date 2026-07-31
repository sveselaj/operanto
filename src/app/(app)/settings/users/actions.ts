"use server";

import { revalidatePath } from "next/cache";
import type { MembershipRole } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import {
  changeMemberRole,
  inviteMember,
  revokeMemberSessions,
  setMemberStatus,
} from "@/lib/services/members";

export type InviteResult = {
  ok?: boolean;
  error?: string;
  devInviteUrl?: string;
};

const ROLES: MembershipRole[] = ["ADMIN", "SUPERVISOR", "OPERATOR"];

export async function inviteMemberAction(
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  const ctx = await requireOrg();
  const role = String(formData.get("role") ?? "") as MembershipRole;
  if (!ROLES.includes(role)) return { error: "Invalid role" };
  try {
    const { devInviteUrl } = await inviteMember(ctx, {
      email: String(formData.get("email") ?? ""),
      role,
    });
    revalidatePath("/settings/users");
    return { ok: true, devInviteUrl };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invitation failed" };
  }
}

export async function changeRoleAction(formData: FormData) {
  const ctx = await requireOrg();
  const role = String(formData.get("role") ?? "") as MembershipRole;
  if (!ROLES.includes(role)) return;
  await changeMemberRole(ctx, String(formData.get("membershipId") ?? ""), role);
  revalidatePath("/settings/users");
}

export async function setMemberStatusAction(formData: FormData) {
  const ctx = await requireOrg();
  const status = String(formData.get("status") ?? "");
  if (status !== "ACTIVE" && status !== "SUSPENDED") return;
  await setMemberStatus(ctx, String(formData.get("membershipId") ?? ""), status);
  revalidatePath("/settings/users");
}

export async function revokeSessionsAction(formData: FormData) {
  const ctx = await requireOrg();
  await revokeMemberSessions(ctx, String(formData.get("membershipId") ?? ""));
  revalidatePath("/settings/users");
}
