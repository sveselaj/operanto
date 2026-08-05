import { LeadStatus, TaskStatus, TaskType } from "@operanto/crm-domain";
import { isClosedStatus } from "@operanto/crm-leadstatus";

/**
 * Next-action engine: deterministic workflow logic (not AI) that turns a
 * lead's state into a structured recommendation. Pure and unit-tested; used by
 * the lead detail banner and the work-queue processing view.
 */

/** Days without activity after which a lead counts as stale. */
export const STALE_AFTER_DAYS = 5;
export const STALE_AFTER_MS = STALE_AFTER_DAYS * 86_400_000;

export interface NextActionTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  dueAt: Date | null;
}

export interface NextActionInput {
  status: LeadStatus;
  doNotCall: boolean;
  callbackAt: Date | null;
  appointmentAt: Date | null;
  nextActionAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  /** OPEN / IN_PROGRESS tasks; optional — enables task-aware recommendations. */
  openTasks?: NextActionTask[];
}

export type NextActionType =
  | "DO_NOT_CONTACT"
  | "CONVERTED"
  | "TERMINAL"
  | "CALLBACK_OVERDUE"
  | "CALLBACK_DUE"
  | "APPOINTMENT_UPCOMING"
  | "TASK_OVERDUE"
  | "THIRD_NO_ANSWER"
  | "RETRY_DUE"
  | "NEW_LEAD"
  | "STALE"
  | "NO_NEXT_ACTION";

export type PrimaryAction = "CALL" | "SCHEDULE" | "NONE";

export interface NextAction {
  type: NextActionType;
  /** 1 = most urgent actionable; 99 = informational (no work required). */
  priority: number;
  /** i18n key inside `leadDetail.nextBestAction`. */
  titleKey: string;
  dueAt: Date | null;
  overdueMs: number | null;
  relatedTaskId: string | null;
  relatedAppointmentId: string | null;
  primaryAction: PrimaryAction;
  /** True when a human supervisor should look at the lead. */
  escalation: boolean;
}

function make(
  type: NextActionType,
  priority: number,
  titleKey: string,
  primaryAction: PrimaryAction,
  extra?: Partial<NextAction>
): NextAction {
  return {
    type,
    priority,
    titleKey,
    dueAt: null,
    overdueMs: null,
    relatedTaskId: null,
    relatedAppointmentId: null,
    primaryAction,
    escalation: false,
    ...extra,
  };
}

export function computeNextAction(lead: NextActionInput, now: Date = new Date()): NextAction {
  const nowMs = now.getTime();

  if (lead.doNotCall || lead.status === LeadStatus.DO_NOT_CONTACT) {
    return make("DO_NOT_CONTACT", 99, "doNotContact", "NONE");
  }
  if (lead.status === LeadStatus.CONVERTED) {
    return make("CONVERTED", 99, "converted", "NONE");
  }
  if (isClosedStatus(lead.status) || lead.status === LeadStatus.WRONG_NUMBER) {
    return make("TERMINAL", 99, "closed", "NONE");
  }

  const openTasks = (lead.openTasks ?? []).filter(
    (t) => t.status === TaskStatus.OPEN || t.status === TaskStatus.IN_PROGRESS
  );
  const callbackTask = openTasks.find((t) => t.type === TaskType.CALLBACK && t.dueAt !== null);
  const callbackDue = callbackTask?.dueAt ?? lead.callbackAt;

  if (lead.status === LeadStatus.CALLBACK && callbackDue) {
    if (callbackDue.getTime() < nowMs) {
      return make("CALLBACK_OVERDUE", 1, "callbackOverdue", "CALL", {
        dueAt: callbackDue,
        overdueMs: nowMs - callbackDue.getTime(),
        relatedTaskId: callbackTask?.id ?? null,
      });
    }
    return make("CALLBACK_DUE", 2, "callbackDue", "CALL", {
      dueAt: callbackDue,
      relatedTaskId: callbackTask?.id ?? null,
    });
  }

  if (lead.appointmentAt && lead.appointmentAt.getTime() >= nowMs) {
    return make("APPOINTMENT_UPCOMING", 3, "appointmentUpcoming", "NONE", {
      dueAt: lead.appointmentAt,
    });
  }

  const overdueTask = openTasks
    .filter((t) => t.dueAt !== null && t.dueAt.getTime() < nowMs)
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))[0];
  if (overdueTask?.dueAt) {
    return make("TASK_OVERDUE", 4, "taskOverdue", "CALL", {
      dueAt: overdueTask.dueAt,
      overdueMs: nowMs - overdueTask.dueAt.getTime(),
      relatedTaskId: overdueTask.id,
    });
  }

  if (lead.status === LeadStatus.NO_ANSWER_3) {
    return make("THIRD_NO_ANSWER", 5, "thirdNoAnswer", "CALL", { escalation: true });
  }

  if (
    lead.status === LeadStatus.RETRY_LATER &&
    lead.nextActionAt &&
    lead.nextActionAt.getTime() <= nowMs
  ) {
    return make("RETRY_DUE", 6, "retryDue", "CALL", {
      dueAt: lead.nextActionAt,
      overdueMs: nowMs - lead.nextActionAt.getTime(),
    });
  }

  if (lead.status === LeadStatus.NEW) {
    return make("NEW_LEAD", 7, "callNow", "CALL");
  }

  const lastTouch = lead.lastActivityAt ?? lead.createdAt;
  if (lastTouch.getTime() < nowMs - STALE_AFTER_MS) {
    return make("STALE", 8, "noActivity", "CALL", {
      overdueMs: nowMs - lastTouch.getTime() - STALE_AFTER_MS,
      dueAt: lastTouch,
    });
  }

  // Active lead with nothing scheduled: the agent must define the next step.
  if (!lead.nextActionAt || lead.nextActionAt.getTime() < nowMs) {
    return make("NO_NEXT_ACTION", 9, "noNextAction", "SCHEDULE");
  }

  return make("NO_NEXT_ACTION", 10, "callNow", "CALL", { dueAt: lead.nextActionAt });
}
