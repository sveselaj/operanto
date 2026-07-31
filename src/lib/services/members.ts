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
import { deliverInvitation } from "@/lib/email";
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
    where: {
      ...scope(ctx),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function inviteMember(
  ctx: OrgContext,
  input: { email: string; role: MembershipRole },
): Promise<{ delivered: boolean; reason?: string; devInviteUrl?: string }> {
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
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    // Issuing a new invitation invalidates any earlier outstanding one for the
    // same address: two live links would mean revoking one leaves a way in.
    await tx.invitation.updateMany({
      where: { ...scope(ctx), email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.invitation.create({
      data: {
        organisationId: ctx.organisation.id,
        email,
        role: input.role,
        tokenHash,
        invitedByUserId: ctx.user.id,
        expiresAt,
      },
    });
  });

  await audit(ctx, {
    eventType: "member.invited",
    targetType: "Invitation",
    targetId: invitation.id,
    after: { email, role: input.role },
  });

  return deliverExisting(ctx, invitation.id, email, input.role, expiresAt, token);
}

/** Shared by invite and resend so both record delivery state identically. */
async function deliverExisting(
  ctx: OrgContext,
  invitationId: string,
  email: string,
  role: MembershipRole,
  expiresAt: Date,
  token: string,
): Promise<{ delivered: boolean; reason?: string; devInviteUrl?: string }> {
  const result = await deliverInvitation({
    to: email,
    organisationName: ctx.organisation.name,
    role,
    acceptUrl: invitationUrl(token),
    expiresAt,
  });

  // Delivery state reflects what actually happened — a failed send must never
  // leave an administrator believing the message is on its way.
  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      deliveryAttempts: { increment: 1 },
      deliveredAt: result.delivered ? new Date() : null,
      lastDeliveryError: result.delivered ? null : result.reason.slice(0, 500),
    },
  });

  await audit(ctx, {
    eventType: result.delivered
      ? "member.invitation_delivered"
      : "member.invitation_delivery_failed",
    targetType: "Invitation",
    targetId: invitationId,
    after: { delivered: result.delivered },
  });

  return result.delivered
    ? { delivered: true }
    : { delivered: false, reason: result.reason, devInviteUrl: result.previewUrl };
}

/**
 * Re-issue an invitation. A fresh token is minted and the previous one is
 * revoked, so a resend can never leave two usable links outstanding.
 */
export async function resendInvitation(
  ctx: OrgContext,
  invitationId: string,
): Promise<{ delivered: boolean; reason?: string; devInviteUrl?: string }> {
  requirePermission(ctx.membership.role, "members:manage");
  const existing = await prisma.invitation.findFirst({
    where: { ...scope(ctx), id: invitationId, acceptedAt: null },
  });
  if (!existing) throw new Error("Invitation not found or already accepted");

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const replacement = await prisma.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return tx.invitation.create({
      data: {
        organisationId: existing.organisationId,
        email: existing.email,
        role: existing.role,
        tokenHash,
        invitedByUserId: ctx.user.id,
        expiresAt,
      },
    });
  });

  await audit(ctx, {
    eventType: "member.invitation_resent",
    targetType: "Invitation",
    targetId: replacement.id,
    before: { replacedInvitationId: existing.id },
  });

  return deliverExisting(
    ctx,
    replacement.id,
    existing.email,
    existing.role,
    expiresAt,
    token,
  );
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
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt < new Date()
  ) {
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
