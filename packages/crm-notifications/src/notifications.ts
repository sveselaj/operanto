import type { NotificationType } from "@operanto/crm-domain";

/**
 * Notification engine contracts (OI-2). The transactional write path
 * (`notify()`) stays Prisma-coupled in the application
 * (src/server/services/notification-core.ts) and MUST satisfy
 * `NotificationContractInput` — asserted at compile time in that file. This
 * package owns the stable, provider-independent parts: the input contract and
 * the dedupe-key conventions the idempotency unique
 * `(userId, type, entityId, dedupeKey)` relies on.
 *
 * Rules (unchanged from Phase 2):
 * - titleKey/messageKey are i18n keys in the `notifications` namespace —
 *   never stored prose.
 * - Never `create` a row with a dedupeKey inside a transaction; a unique
 *   violation aborts the whole Postgres transaction. Use
 *   `createMany({ skipDuplicates: true })`.
 */
export interface NotificationContractInput {
  organizationId: string;
  userId: string;
  type: NotificationType;
  titleKey: string;
  messageKey: string;
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
  dedupeKey?: string;
}

/**
 * Dedupe-key builders — the exact string formats the production data already
 * uses. Changing a format silently re-notifies every open item; that is why
 * they live here, in one tested place.
 */
export const notificationDedupeKeys = {
  /** Time-derived task reminders: a reschedule (new dueAt) correctly re-arms. */
  taskDue: (taskId: string, dueAt: Date): string =>
    `${taskId}:${dueAt.toISOString()}:due`,
  taskOverdue: (taskId: string, dueAt: Date): string =>
    `${taskId}:${dueAt.toISOString()}:overdue`,
  appointmentUpcoming: (appointmentId: string, startAt: Date): string =>
    `${appointmentId}:${startAt.toISOString()}:upcoming`,
  /** Import lifecycle: once per job and outcome. */
  importCompleted: (jobId: string): string => `${jobId}:completed`,
  importReview: (jobId: string): string => `${jobId}:review`,
  importFailed: (jobId: string): string => `${jobId}:failed`,
  importAssign: (jobId: string): string => `${jobId}:assign`,
  /** Assignment-failure noise control: at most one per user and day (UTC). */
  dayBucket: (now: Date): string => now.toISOString().slice(0, 10),
} as const;
