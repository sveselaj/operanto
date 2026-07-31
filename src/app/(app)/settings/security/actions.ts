"use server";

import bcrypt from "bcryptjs";
import { requireOrg } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { passwordSchema, BCRYPT_ROUNDS } from "@/lib/passwords";
import { signOut } from "@/lib/auth";

export async function changePasswordAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const ctx = await requireOrg();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPasswordRaw = String(formData.get("newPassword") ?? "");

  const parsed = passwordSchema.safeParse(newPasswordRaw);
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Password does not meet the policy";
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return "Current password is incorrect";
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data, BCRYPT_ROUNDS),
      passwordUpdatedAt: new Date(),
      sessionsRevokedAt: new Date(),
    },
  });
  await audit(ctx, {
    eventType: "user.password_changed",
    targetType: "User",
    targetId: user.id,
  });
  await signOut({ redirectTo: "/login" });
  return null;
}
