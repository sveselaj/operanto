import { describe, expect, it } from "vitest";
import {
  AppointmentStatus,
  LeadStatus,
  TaskStatus,
  TaskType,
} from "@operanto/crm-domain";
import {
  buildWorkQueue,
  isQueueEligible,
  type QueueCandidate,
} from "./work-queue";

const NOW = new Date("2026-08-04T12:00:00Z");
const END_OF_TODAY = new Date("2026-08-04T21:59:59Z");
const ME = "agent-1";

let counter = 0;
function candidate(overrides: Partial<QueueCandidate>): QueueCandidate {
  counter += 1;
  return {
    id: `lead-${String(counter).padStart(3, "0")}`,
    fullName: `Lead ${counter}`,
    companyName: null,
    phone: "+49301234567",
    status: LeadStatus.CONTACTED,
    doNotCall: false,
    archivedAt: null,
    assignedUserId: ME,
    lastActivityAt: new Date("2026-08-04T09:00:00Z"),
    nextActionAt: null,
    createdAt: new Date("2026-08-01T09:00:00Z"),
    openTasks: [],
    nextAppointment: null,
    activeLock: null,
    ...overrides,
  };
}

function callbackTask(dueAt: Date, id = `task-${counter}`) {
  return { id, type: TaskType.CALLBACK, status: TaskStatus.OPEN, dueAt };
}

describe("work queue exclusions", () => {
  it.each([
    LeadStatus.CONVERTED,
    LeadStatus.REJECTED,
    LeadStatus.LOST,
    LeadStatus.WRONG_NUMBER,
    LeadStatus.DO_NOT_CONTACT,
  ])("excludes terminal status %s", (status) => {
    expect(isQueueEligible(candidate({ status }), ME, NOW)).toBe(false);
  });

  it("excludes do-not-call leads regardless of status", () => {
    expect(isQueueEligible(candidate({ doNotCall: true }), ME, NOW)).toBe(false);
  });

  it("excludes archived leads", () => {
    expect(isQueueEligible(candidate({ archivedAt: new Date() }), ME, NOW)).toBe(false);
  });

  it("excludes other agents' and unassigned leads", () => {
    expect(isQueueEligible(candidate({ assignedUserId: "agent-2" }), ME, NOW)).toBe(false);
    expect(isQueueEligible(candidate({ assignedUserId: null }), ME, NOW)).toBe(false);
  });

  it("excludes leads actively locked by another agent", () => {
    const locked = candidate({
      activeLock: {
        userId: "agent-2",
        userName: "Other",
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    });
    expect(isQueueEligible(locked, ME, NOW)).toBe(false);
  });

  it("does NOT exclude leads with an expired foreign lock or an own lock", () => {
    const expired = candidate({
      activeLock: {
        userId: "agent-2",
        userName: "Other",
        expiresAt: new Date(NOW.getTime() - 60_000),
      },
    });
    const own = candidate({
      activeLock: { userId: ME, userName: "Me", expiresAt: new Date(NOW.getTime() + 60_000) },
    });
    expect(isQueueEligible(expired, ME, NOW)).toBe(true);
    expect(isQueueEligible(own, ME, NOW)).toBe(true);
  });
});

describe("work queue ordering", () => {
  it("orders categories by priority", () => {
    const overdueCallback = candidate({
      status: LeadStatus.CALLBACK,
      openTasks: [callbackTask(new Date("2026-08-04T10:00:00Z"), "cb-overdue")],
    });
    const dueCallback = candidate({
      status: LeadStatus.CALLBACK,
      openTasks: [callbackTask(new Date("2026-08-04T12:30:00Z"), "cb-due")],
    });
    const appointmentPrep = candidate({
      status: LeadStatus.APPOINTMENT,
      nextAppointment: {
        id: "appt-1",
        startAt: new Date("2026-08-04T18:00:00Z"),
        status: AppointmentStatus.SCHEDULED,
      },
    });
    const overdueTask = candidate({
      openTasks: [
        {
          id: "doc-1",
          type: TaskType.DOCUMENT_REQUEST,
          status: TaskStatus.OPEN,
          dueAt: new Date("2026-08-04T08:00:00Z"),
        },
      ],
    });
    const newLead = candidate({ status: LeadStatus.NEW });
    const stale = candidate({ lastActivityAt: new Date("2026-07-20T09:00:00Z") });
    const dueToday = candidate({ nextActionAt: new Date("2026-08-04T16:00:00Z") });
    const other = candidate({});

    const entries = buildWorkQueue(
      [other, dueToday, stale, newLead, overdueTask, appointmentPrep, dueCallback, overdueCallback],
      ME,
      NOW,
      END_OF_TODAY
    );

    expect(entries.map((e) => e.category)).toEqual([
      "CALLBACK_OVERDUE",
      "CALLBACK_DUE",
      "APPOINTMENT_PREP",
      "TASK_OVERDUE",
      "NEW_LEAD",
      "NO_ACTIVITY",
      "DUE_TODAY",
      "OTHER_ACTIVE",
    ]);
    expect(entries[0].relatedTaskId).toBe("cb-overdue");
    expect(entries[0].overdueMs).toBe(2 * 3_600_000);
    expect(entries[2].relatedAppointmentId).toBe("appt-1");
  });

  it("sorts most-overdue callbacks first within the category", () => {
    const older = candidate({
      status: LeadStatus.CALLBACK,
      openTasks: [callbackTask(new Date("2026-08-03T10:00:00Z"), "older")],
    });
    const newer = candidate({
      status: LeadStatus.CALLBACK,
      openTasks: [callbackTask(new Date("2026-08-04T11:00:00Z"), "newer")],
    });
    const entries = buildWorkQueue([newer, older], ME, NOW, END_OF_TODAY);
    expect(entries.map((e) => e.relatedTaskId)).toEqual(["older", "newer"]);
  });

  it("callbacks due beyond 60 minutes REST until due (Phase 2.1 rule)", () => {
    const later = candidate({
      status: LeadStatus.CALLBACK,
      openTasks: [callbackTask(new Date("2026-08-04T14:00:00Z"))],
      nextActionAt: new Date("2026-08-04T14:00:00Z"),
    });
    expect(buildWorkQueue([later], ME, NOW, END_OF_TODAY)).toHaveLength(0);
  });

  it("a future next action beyond today rests; unscheduled active leads stay listed", () => {
    const scheduled = candidate({ nextActionAt: new Date("2026-08-06T10:00:00Z") });
    const unscheduled = candidate({});
    const entries = buildWorkQueue([scheduled, unscheduled], ME, NOW, END_OF_TODAY);
    expect(entries.map((e) => e.lead.id)).toEqual([unscheduled.id]);
    expect(entries[0].category).toBe("OTHER_ACTIVE");
  });

  it("is deterministic: identical input arrays in any order yield the same result", () => {
    const a = candidate({ status: LeadStatus.NEW, createdAt: new Date("2026-08-01T00:00:00Z") });
    const b = candidate({ status: LeadStatus.NEW, createdAt: new Date("2026-08-01T00:00:00Z") });
    const first = buildWorkQueue([a, b], ME, NOW, END_OF_TODAY);
    const second = buildWorkQueue([b, a], ME, NOW, END_OF_TODAY);
    expect(first.map((e) => e.lead.id)).toEqual(second.map((e) => e.lead.id));
    // Tie on createdAt breaks on id.
    expect(first.map((e) => e.lead.id)).toEqual([a.id, b.id].sort());
  });

  it("every lead appears at most once, in its highest category", () => {
    const both = candidate({
      status: LeadStatus.CALLBACK,
      openTasks: [
        callbackTask(new Date("2026-08-04T10:00:00Z"), "cb"),
        {
          id: "doc",
          type: TaskType.DOCUMENT_REQUEST,
          status: TaskStatus.OPEN,
          dueAt: new Date("2026-08-04T08:00:00Z"),
        },
      ],
    });
    const entries = buildWorkQueue([both], ME, NOW, END_OF_TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("CALLBACK_OVERDUE");
  });
});
