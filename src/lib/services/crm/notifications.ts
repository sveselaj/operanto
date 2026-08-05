import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scope, type OrgContext } from "@/lib/org-context";
import {
  notificationDedupeKeys,
  type NotificationContractInput,
} from "@operanto/crm-notifications";

/**
 * Notification engine (OI-4) — the platform's first user-directed signal
 * surface, contributed by the CRM per the OI assessment (Operanto's own gap
 * analysis listed notifications as Missing).
 *
 * Rules carried over from the standalone CRM:
 * - ONE write path (`notify`), which joins the caller's transaction so a
 *   notification cannot exist without the change that caused it.
 * - Payloads are i18n keys, never stored prose.
 * - Idempotency by constraint: (membership, type, entity, dedupeKey). Never
 *   `create` a dedupe-keyed row inside a transaction — a unique violation
 *   aborts the whole Postgres transaction; use `notifyMany` (createMany with
 *   skipDuplicates) for anything that can legitimately repeat.
 * - Reads are strictly self-scoped: a membership can only ever see its own.
 */

export { notificationDedupeKeys };

/** Recipient is a MEMBERSHIP (the platform's assignment principal). */
export interface NotifyInput {
  organisationId: string;
  membershipId: string;
  type: string;
  titleKey: string;
  messageKey: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  dedupeKey?: string;
}

/**
 * Compile-time check on the fields shared with the extracted contract. Two
 * fields deliberately differ and are therefore excluded: the RECIPIENT (the
 * package addresses a `userId`; the platform addresses a `membershipId`, its
 * assignment principal) and the TENANT (`organizationId` vs Operanto's
 * `organisationId` — the spelling split recorded in the canonical domain
 * model). The payload discipline — i18n keys, never prose — and the
 * dedupeKey contract must stay identical, and that is what this asserts.
 */
type SharedFields = "titleKey" | "messageKey" | "entityType" | "entityId" | "dedupeKey";
type Assert<T extends true> = T;
export type NotifyContractCheck = Assert<
  Pick<NotifyInput, SharedFields> extends Pick<NotificationContractInput, SharedFields>
    ? true
    : false
>;

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Single write path; joins the caller's transaction. */
export async function notify(client: DbClient, input: NotifyInput): Promise<void> {
  await client.notification.create({ data: input });
}

/** Idempotent bulk path — safe inside a transaction (no unique-violation abort). */
export async function notifyMany(client: DbClient, inputs: NotifyInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const result = await client.notification.createMany({
    data: inputs,
    skipDuplicates: true,
  });
  return result.count;
}

export async function listMyNotifications(ctx: OrgContext, limit = 30) {
  return prisma.notification.findMany({
    where: { ...scope(ctx), membershipId: ctx.membership.id, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function unreadNotificationCount(ctx: OrgContext): Promise<number> {
  return prisma.notification.count({
    where: {
      ...scope(ctx),
      membershipId: ctx.membership.id,
      readAt: null,
      dismissedAt: null,
    },
  });
}

/**
 * Mark one notification read. Scoped to the caller's own membership — an id
 * from the client can never reach another person's row.
 */
export async function markNotificationRead(ctx: OrgContext, id: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { ...scope(ctx), id, membershipId: ctx.membership.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(ctx: OrgContext): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { ...scope(ctx), membershipId: ctx.membership.id, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function dismissNotification(ctx: OrgContext, id: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { ...scope(ctx), id, membershipId: ctx.membership.id },
    data: { dismissedAt: new Date() },
  });
}
