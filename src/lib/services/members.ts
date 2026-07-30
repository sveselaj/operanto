import "server-only";
import bcrypt from "bcryptjs";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import {
  INVITATION_TTL_MS,
  generateInvitationToken,
  hashInvitationToken,
  invitationUrl,
} from "@/lib/invitations";
import { sendMail } from "@/lib/email";
import { passwordSchema, BCRYPT_ROUNDS } from "@/lib/passwords";

/**
 * Membership management. Onboarding is invitation-only; there is no public
 * registration path anywhere in the app. Final-admin protection: the last
 * ACTIVE ADMIN of an organisation cannot be demoted or suspended.
 */

export async function listMembers(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "members:manage");
  return prisma.membership.findMany({
    where: scope(ctx),
    include: { user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function listPendingInvitations(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "members:manage");
  return prisma.invitation.findMany({
    where: { ...scope(ctx), acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export async function inviteMember(
  ctx: OrgContext,
  input: { email: string; role: MembershipRole },
): Promise<{ devInviteUrl?: string }> {
  requirePermission(ctx.membership.role, "members:manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMembership = await prisma.membership.findFirst({
      where: { ...scope(ctx), userId: existingUser.id },
    });
    if (existingMembership) throw new Error("Already a member of this organisation");
  }

  const { token, tokenHash } = generateInvitationToken();
  await prisma.invitation.create({
    data: {
      organisationId: ctx.organisation.id,
      email,
      role: input.role,
      tokenHash,
      invitedByUserId: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  await audit(ctx, {
    eventType: "member.invited",
    targetType: "Invitation",
    after: { email, role: input.role },
  });

  const url = invitationUrl(token);
  const { delivered } = await sendMail({
    to: email,
    subject: `You have been invited to ${ctx.organisation.name} on Operanto`,
    text: `You have been invited to join ${ctx.organisation.name} on Operanto as ${input.role}.\n\nAccept the invitation (valid 7 days):\n${url}\n\nIf you did not expect this email you can ignore it.`,
  });
  // In development (no email provider) surface the link to the admin UI once;
  // it is never logged with the token by any other path.
  return delivered ? {} : { devInviteUrl: url };
}

export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ email: string }> {
  const tokenHash = hashInvitationToken(input.token);
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    include: { organisation: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new Error("Invitation is invalid or has expired");
  }
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Name is required");
  const password = passwordSchema.parse(input.password);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count === 0) throw new Error("Invitation already used");

    const user = await tx.user.upsert({
      where: { email: invitation.email },
      create: {
        email: invitation.email,
        name,
        passwordHash,
        status: "ACTIVE",
        passwordUpdatedAt: new Date(),
      },
      // Existing user accepting an invite to another organisation: keep their
      // credentials; never overwrite the password of an existing account.
      update: {},
    });
    if (user.status !== "ACTIVE") throw new Error("Account is suspended");

    await tx.membership.upsert({
      where: {
        organisationId_userId: {
          organisationId: invitation.organisationId,
          userId: user.id,
        },
      },
      create: {
        organisationId: invitation.organisationId,
        userId: user.id,
        role: invitation.role,
        status: "ACTIVE",
      },
      update: { status: "ACTIVE", role: invitation.role },
    });

    await tx.auditEvent.create({
      data: {
        organisationId: invitation.organisationId,
        actorType: "STAFF",
        actorUserId: user.id,
        eventType: "member.invitation_accepted",
        targetType: "Membership",
        afterMetadata: { email: invitation.email, role: invitation.role },
      },
    });
  });

  return { email: invitation.email };
}

async function assertNotFinalAdmin(ctx: OrgContext, membershipId: string) {
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, ...scope(ctx) },
  });
  if (!target) throw new Error("Member not found");
  if (target.role === "ADMIN" && target.status === "ACTIVE") {
    const otherAdmins = await prisma.membership.count({
      where: {
        ...scope(ctx),
        role: "ADMIN",
        status: "ACTIVE",
        id: { not: membershipId },
      },
    });
    if (otherAdmins === 0) {
      throw new Error("Cannot remove or demote the final administrator");
    }
  }
  return target;
}

export async function changeMemberRole(
  ctx: OrgContext,
  membershipId: string,
  role: MembershipRole,
) {
  requirePermission(ctx.membership.role, "members:manage");
  const target = await assertNotFinalAdmin(ctx, membershipId);
  if (target.role === role) return;
  await prisma.membership.update({ where: { id: target.id }, data: { role } });
  await audit(ctx, {
    eventType: "member.role_changed",
    targetType: "Membership",
    targetId: target.id,
    before: { role: target.role },
    after: { role },
  });
}

export async function setMemberStatus(
  ctx: OrgContext,
  membershipId: string,
  status: "ACTIVE" | "SUSPENDED",
) {
  requirePermission(ctx.membership.role, "members:manage");
  if (membershipId === ctx.membership.id && status === "SUSPENDED") {
    throw new Error("You cannot suspend your own membership");
  }
  const target = await assertNotFinalAdmin(ctx, membershipId);
  if (target.status === status) return;
  await prisma.membership.update({ where: { id: target.id }, data: { status } });
  await audit(ctx, {
    eventType: status === "SUSPENDED" ? "member.suspended" : "member.reactivated",
    targetType: "Membership",
    targetId: target.id,
    before: { status: target.status },
    after: { status },
  });
}

/** Immediately invalidate every session of the target user (org-scoped check). */
export async function revokeMemberSessions(ctx: OrgContext, membershipId: string) {
  requirePermission(ctx.membership.role, "members:manage");
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, ...scope(ctx) },
  });
  if (!target) throw new Error("Member not found");
  await prisma.user.update({
    where: { id: target.userId },
    data: { sessionsRevokedAt: new Date() },
  });
  await audit(ctx, {
    eventType: "member.sessions_revoked",
    targetType: "Membership",
    targetId: target.id,
  });
}
