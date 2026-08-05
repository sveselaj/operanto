import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { notify } from "./notifications";

/**
 * Work locks (OI-4): an exclusive work session on a lead, so two agents never
 * call the same person at the same moment.
 *
 * The single-active-lock guarantee is a PARTIAL UNIQUE INDEX in the migration
 * (leadId WHERE releasedAt IS NULL), not application logic — concurrent
 * acquire attempts are resolved by the database, and the loser reads the
 * winner. Expiry never depends on user traffic: an expired lock is swept on
 * the next acquire (and, later, by the scheduled sweep).
 */

export const LOCK_TTL_MS = 10 * 60_000;

export interface LockResult {
  acquired: boolean;
  expiresAt?: Date;
  /** Present when someone else holds it — name only, no further personal data. */
  holder?: { membershipId: string; name: string; expiresAt: Date };
}

async function expireStaleLocks(leadId: string, now: Date): Promise<void> {
  await prisma.leadWorkLock.updateMany({
    where: { leadId, releasedAt: null, expiresAt: { lte: now } },
    data: { releasedAt: now, releaseReason: "EXPIRED" },
  });
}

async function readHolder(leadId: string): Promise<LockResult["holder"] | undefined> {
  const held = await prisma.leadWorkLock.findFirst({
    where: { leadId, releasedAt: null },
    include: { holder: { include: { user: { select: { name: true } } } } },
  });
  if (!held) return undefined;
  return {
    membershipId: held.membershipId,
    name: held.holder.user.name,
    expiresAt: held.expiresAt,
  };
}

export async function acquireLock(ctx: OrgContext, leadId: string): Promise<LockResult> {
  requirePermission(ctx.membership.role, "crm.leads.transition");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  const lead = await prisma.lead.findFirst({
    where: { ...scope(ctx), id: leadId, archivedAt: null },
    select: { id: true },
  });
  if (!lead) throw new Error("Lead not found");

  await expireStaleLocks(leadId, now);

  const existing = await prisma.leadWorkLock.findFirst({
    where: { leadId, releasedAt: null },
  });
  if (existing) {
    if (existing.membershipId === ctx.membership.id) {
      // Same holder: refresh rather than refuse.
      await prisma.leadWorkLock.update({
        where: { id: existing.id },
        data: { expiresAt, refreshedAt: now },
      });
      return { acquired: true, expiresAt };
    }
    return { acquired: false, holder: await readHolder(leadId) };
  }

  try {
    await prisma.leadWorkLock.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId,
        membershipId: ctx.membership.id,
        expiresAt,
      },
    });
    return { acquired: true, expiresAt };
  } catch (error) {
    // Lost the race against the partial unique index — read the winner.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const holder = await readHolder(leadId);
      return holder
        ? { acquired: false, holder }
        : // The winner released between our insert and this read; one retry.
          acquireLock(ctx, leadId);
    }
    throw error;
  }
}

/** Extend an already-held lock. Returns false when it is no longer ours. */
export async function refreshLock(ctx: OrgContext, leadId: string): Promise<boolean> {
  const now = new Date();
  const result = await prisma.leadWorkLock.updateMany({
    where: { leadId, membershipId: ctx.membership.id, releasedAt: null },
    data: { expiresAt: new Date(now.getTime() + LOCK_TTL_MS), refreshedAt: now },
  });
  return result.count > 0;
}

export async function releaseLock(
  ctx: OrgContext,
  leadId: string,
  reason: "COMPLETED" | "NEXT" | "EXIT" = "EXIT",
): Promise<void> {
  await prisma.leadWorkLock.updateMany({
    where: { leadId, membershipId: ctx.membership.id, releasedAt: null },
    data: { releasedAt: new Date(), releaseReason: reason },
  });
}

export async function releaseAllMyLocks(ctx: OrgContext): Promise<number> {
  const result = await prisma.leadWorkLock.updateMany({
    where: { ...scope(ctx), membershipId: ctx.membership.id, releasedAt: null },
    data: { releasedAt: new Date(), releaseReason: "LOGOUT" },
  });
  return result.count;
}

/**
 * Managerial override: take a lock from its holder. Audited, and the
 * displaced holder is notified — an override is never silent.
 */
export async function overrideLock(ctx: OrgContext, leadId: string): Promise<void> {
  requirePermission(ctx.membership.role, "crm.locks.override");
  const now = new Date();
  const existing = await prisma.leadWorkLock.findFirst({
    where: { leadId, releasedAt: null, ...scope(ctx) },
  });
  if (!existing) throw new Error("This lead is not locked");

  await prisma.$transaction(async (tx) => {
    await tx.leadWorkLock.update({
      where: { id: existing.id },
      data: { releasedAt: now, releaseReason: "OVERRIDDEN" },
    });
    await tx.leadWorkLock.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId,
        membershipId: ctx.membership.id,
        expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
      },
    });
    if (existing.membershipId !== ctx.membership.id) {
      await notify(tx, {
        organisationId: ctx.organisation.id,
        membershipId: existing.membershipId,
        type: "LOCK_OVERRIDDEN",
        titleKey: "lockOverridden",
        messageKey: "lockOverriddenMessage",
        entityType: "Lead",
        entityId: leadId,
      });
    }
  });

  await audit(ctx, {
    eventType: "crm.lock.overridden",
    targetType: "Lead",
    targetId: leadId,
    before: { membershipId: existing.membershipId },
    after: { membershipId: ctx.membership.id },
  });
}

/** True when someone else currently holds this lead (for UI gating). */
export async function lockedByOther(ctx: OrgContext, leadId: string): Promise<boolean> {
  const holder = await readHolder(leadId);
  return Boolean(holder && holder.membershipId !== ctx.membership.id);
}

export { can };
