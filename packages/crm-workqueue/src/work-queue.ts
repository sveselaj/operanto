import {
  AppointmentStatus,
  LeadStatus,
  TaskStatus,
  TaskType,
} from "@operanto/crm-domain";
import { STALE_AFTER_MS } from "@operanto/crm-nextaction";

/**
 * Deterministic work-queue builder. Pure function over pre-fetched data so the
 * ordering and exclusions are unit-testable; the queue service supplies the
 * candidates (already tenant-scoped and assigned to the requesting agent).
 *
 * Priority categories, highest first — see docs/PHASE2_DESIGN.md §3.
 */

export const QUEUE_CATEGORIES = [
  "CALLBACK_OVERDUE",
  "CALLBACK_DUE",
  "APPOINTMENT_PREP",
  "TASK_OVERDUE",
  "NEW_LEAD",
  "NO_ACTIVITY",
  "DUE_TODAY",
  "OTHER_ACTIVE",
] as const;
export type QueueCategory = (typeof QUEUE_CATEGORIES)[number];

/** Callbacks due within this window count as "due now". */
export const CALLBACK_DUE_WINDOW_MS = 60 * 60 * 1000;
/** Appointments starting within this window need preparation. */
export const APPOINTMENT_PREP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Statuses that never appear in the queue (plus doNotCall/archived flags). */
export const QUEUE_EXCLUDED_STATUSES: readonly LeadStatus[] = [
  LeadStatus.CONVERTED,
  LeadStatus.REJECTED,
  LeadStatus.LOST,
  LeadStatus.WRONG_NUMBER,
  LeadStatus.DO_NOT_CONTACT,
] as const;

export interface QueueTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  dueAt: Date | null;
}

export interface QueueAppointment {
  id: string;
  startAt: Date;
  status: AppointmentStatus;
}

export interface QueueLock {
  userId: string;
  userName: string;
  expiresAt: Date;
}

export interface QueueCandidate {
  id: string;
  fullName: string;
  companyName: string | null;
  phone: string | null;
  status: LeadStatus;
  doNotCall: boolean;
  archivedAt: Date | null;
  assignedUserId: string | null;
  lastActivityAt: Date | null;
  nextActionAt: Date | null;
  createdAt: Date;
  /** OPEN / IN_PROGRESS tasks only. */
  openTasks: QueueTask[];
  /** Next SCHEDULED / CONFIRMED appointment, if any. */
  nextAppointment: QueueAppointment | null;
  /** Unreleased lock, if any (expiry checked against `now` here). */
  activeLock: QueueLock | null;
}

export interface QueueEntry {
  lead: QueueCandidate;
  category: QueueCategory;
  /** 1 = highest. */
  priority: number;
  /** i18n key inside the `queue.reason` namespace (equals the category). */
  reasonKey: QueueCategory;
  dueAt: Date | null;
  overdueMs: number | null;
  relatedTaskId: string | null;
  relatedAppointmentId: string | null;
  /** Set when the requesting user holds the lock. */
  ownLock: boolean;
}

function isOpen(task: QueueTask): boolean {
  return task.status === TaskStatus.OPEN || task.status === TaskStatus.IN_PROGRESS;
}

interface Classification {
  category: QueueCategory;
  dueAt: Date | null;
  relatedTaskId: string | null;
  relatedAppointmentId: string | null;
  /** Ascending comparison value inside the category. */
  sortValue: number;
}

/**
 * null = the lead RESTS: it has a future schedule (callback beyond the due
 * window / next action after today) and returns to the queue only when due
 * (Phase 2.1 correction — docs/PHASE2_1_DESIGN.md §6).
 */
function classify(lead: QueueCandidate, now: Date, endOfToday: Date): Classification | null {
  const nowMs = now.getTime();
  const openTasks = lead.openTasks.filter(isOpen);
  const callback = openTasks.find((t) => t.type === TaskType.CALLBACK && t.dueAt !== null);

  if (callback?.dueAt && callback.dueAt.getTime() < nowMs) {
    return {
      category: "CALLBACK_OVERDUE",
      dueAt: callback.dueAt,
      relatedTaskId: callback.id,
      relatedAppointmentId: null,
      sortValue: callback.dueAt.getTime(),
    };
  }
  if (callback?.dueAt && callback.dueAt.getTime() <= nowMs + CALLBACK_DUE_WINDOW_MS) {
    return {
      category: "CALLBACK_DUE",
      dueAt: callback.dueAt,
      relatedTaskId: callback.id,
      relatedAppointmentId: null,
      sortValue: callback.dueAt.getTime(),
    };
  }
  const appointment =
    lead.nextAppointment &&
    (lead.nextAppointment.status === AppointmentStatus.SCHEDULED ||
      lead.nextAppointment.status === AppointmentStatus.CONFIRMED) &&
    lead.nextAppointment.startAt.getTime() >= nowMs &&
    lead.nextAppointment.startAt.getTime() <= nowMs + APPOINTMENT_PREP_WINDOW_MS
      ? lead.nextAppointment
      : null;
  const prepTask = openTasks.find(
    (t) =>
      t.type === TaskType.APPOINTMENT_PREP &&
      t.dueAt !== null &&
      t.dueAt.getTime() <= nowMs + APPOINTMENT_PREP_WINDOW_MS &&
      t.dueAt.getTime() >= nowMs
  );
  if (appointment || prepTask) {
    const dueAt = appointment?.startAt ?? prepTask?.dueAt ?? null;
    return {
      category: "APPOINTMENT_PREP",
      dueAt,
      relatedTaskId: prepTask?.id ?? null,
      relatedAppointmentId: appointment?.id ?? null,
      sortValue: dueAt?.getTime() ?? nowMs,
    };
  }
  // Scheduled callback further out (and no imminent appointment): the lead
  // rests and returns to the queue only when due (Phase 2.1 correction).
  if (callback?.dueAt) return null;

  const overdueTask = openTasks
    .filter((t) => t.type !== TaskType.CALLBACK && t.dueAt !== null && t.dueAt.getTime() < nowMs)
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))[0];
  if (overdueTask?.dueAt) {
    return {
      category: "TASK_OVERDUE",
      dueAt: overdueTask.dueAt,
      relatedTaskId: overdueTask.id,
      relatedAppointmentId: null,
      sortValue: overdueTask.dueAt.getTime(),
    };
  }

  if (lead.status === LeadStatus.NEW) {
    return {
      category: "NEW_LEAD",
      dueAt: null,
      relatedTaskId: null,
      relatedAppointmentId: null,
      sortValue: lead.createdAt.getTime(),
    };
  }

  const lastTouch = lead.lastActivityAt ?? lead.createdAt;
  if (lastTouch.getTime() < nowMs - STALE_AFTER_MS) {
    return {
      category: "NO_ACTIVITY",
      dueAt: null,
      relatedTaskId: null,
      relatedAppointmentId: null,
      sortValue: lastTouch.getTime(),
    };
  }

  if (
    lead.nextActionAt &&
    lead.nextActionAt.getTime() >= nowMs &&
    lead.nextActionAt.getTime() <= endOfToday.getTime()
  ) {
    return {
      category: "DUE_TODAY",
      dueAt: lead.nextActionAt,
      relatedTaskId: null,
      relatedAppointmentId: null,
      sortValue: lead.nextActionAt.getTime(),
    };
  }
  // Next action scheduled beyond today: rest until due.
  if (lead.nextActionAt && lead.nextActionAt.getTime() > endOfToday.getTime()) {
    return null;
  }

  return {
    category: "OTHER_ACTIVE",
    dueAt: null,
    relatedTaskId: null,
    relatedAppointmentId: null,
    // Most recently touched first.
    sortValue: -lastTouch.getTime(),
  };
}

export function isQueueEligible(lead: QueueCandidate, forUserId: string, now: Date): boolean {
  if (lead.archivedAt !== null) return false;
  if (lead.doNotCall) return false;
  if (QUEUE_EXCLUDED_STATUSES.includes(lead.status)) return false;
  if (lead.assignedUserId !== forUserId) return false;
  if (
    lead.activeLock &&
    lead.activeLock.userId !== forUserId &&
    lead.activeLock.expiresAt.getTime() > now.getTime()
  ) {
    return false;
  }
  return true;
}

export function buildWorkQueue(
  candidates: QueueCandidate[],
  forUserId: string,
  now: Date,
  endOfToday: Date
): QueueEntry[] {
  const priorityOf = (c: QueueCategory): number => QUEUE_CATEGORIES.indexOf(c) + 1;

  return candidates
    .filter((lead) => isQueueEligible(lead, forUserId, now))
    .flatMap((lead) => {
      const cls = classify(lead, now, endOfToday);
      if (cls === null) return []; // resting until its schedule is due
      const overdueMs =
        cls.dueAt && cls.dueAt.getTime() < now.getTime()
          ? now.getTime() - cls.dueAt.getTime()
          : null;
      const entry: QueueEntry = {
        lead,
        category: cls.category,
        priority: priorityOf(cls.category),
        reasonKey: cls.category,
        dueAt: cls.dueAt,
        overdueMs,
        relatedTaskId: cls.relatedTaskId,
        relatedAppointmentId: cls.relatedAppointmentId,
        ownLock:
          lead.activeLock?.userId === forUserId &&
          lead.activeLock.expiresAt.getTime() > now.getTime(),
      };
      return [{ entry, sortValue: cls.sortValue }];
    })
    .sort(
      (a, b) =>
        a.entry.priority - b.entry.priority ||
        a.sortValue - b.sortValue ||
        a.entry.lead.createdAt.getTime() - b.entry.lead.createdAt.getTime() ||
        (a.entry.lead.id < b.entry.lead.id ? -1 : a.entry.lead.id > b.entry.lead.id ? 1 : 0)
    )
    .map((pair) => pair.entry);
}
