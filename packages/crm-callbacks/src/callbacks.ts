import { OPEN_TASK_STATUSES, TaskPriority, TaskType } from "@operanto/crm-domain";
import type { TaskStatus } from "@operanto/crm-domain";

/**
 * Callback invariant rules (OI-2; extracted from the Phase 2 services —
 * behavior unchanged, the services now consume these instead of inlining
 * them).
 *
 * THE invariant: at most ONE open CALLBACK task per lead. Scheduling a
 * callback always UPSERTS that task; creating a second one is forbidden in
 * every code path. Terminal lead statuses auto-cancel it; non-callback call
 * outcomes complete it.
 */

/** A callback is "open" in exactly the general open-task states. */
export const OPEN_CALLBACK_STATUSES: readonly TaskStatus[] = OPEN_TASK_STATUSES;

export const CALLBACK_TASK_TYPE: TaskType = TaskType.CALLBACK;

/**
 * Priority rule from the call-outcome flow: an explicit customer callback
 * promise is HIGH; a mere retry is NORMAL. Status-transition and reschedule
 * paths always schedule promises (HIGH).
 */
export function callbackPriorityFor(kind: "CALLBACK" | "RETRY"): TaskPriority {
  return kind === "CALLBACK" ? TaskPriority.HIGH : TaskPriority.NORMAL;
}

/** Callback due-soon reminder default (sweep), in minutes. */
export const DEFAULT_TASK_REMINDER_MINUTES = 15;

export interface CallbackUpsertPlan {
  action: "reschedule" | "create";
  /** Present when action is "reschedule" — the one open callback task. */
  taskId?: string;
  dueAt: Date;
}

/**
 * The upsert decision, pure: given the (at most one) open callback task,
 * reschedule it or create the first one. Callers execute the plan inside
 * their transaction and MUST NOT create a callback task outside it.
 */
export function planCallbackUpsert(
  existingOpenCallbackId: string | null | undefined,
  dueAt: Date
): CallbackUpsertPlan {
  return existingOpenCallbackId
    ? { action: "reschedule", taskId: existingOpenCallbackId, dueAt }
    : { action: "create", dueAt };
}
