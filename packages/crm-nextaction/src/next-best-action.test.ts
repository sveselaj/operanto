import { describe, expect, it } from "vitest";
import { LeadStatus, TaskStatus, TaskType } from "@operanto/crm-domain";
import {
  computeNextAction,
  type NextActionInput,
  type NextActionTask,
} from "./next-best-action";

const NOW = new Date("2026-08-04T12:00:00Z");

function lead(overrides: Partial<NextActionInput>): NextActionInput {
  return {
    status: LeadStatus.CONTACTED,
    doNotCall: false,
    callbackAt: null,
    appointmentAt: null,
    nextActionAt: null,
    lastActivityAt: new Date("2026-08-04T09:00:00Z"),
    createdAt: new Date("2026-08-01T09:00:00Z"),
    ...overrides,
  };
}

function task(overrides: Partial<NextActionTask>): NextActionTask {
  return {
    id: "task-1",
    type: TaskType.CALLBACK,
    status: TaskStatus.OPEN,
    dueAt: new Date("2026-08-04T10:00:00Z"),
    ...overrides,
  };
}

describe("computeNextAction", () => {
  it("do-not-contact wins over everything and blocks calling", () => {
    const action = computeNextAction(
      lead({ doNotCall: true, callbackAt: new Date("2026-08-04T10:00:00Z") }),
      NOW
    );
    expect(action.type).toBe("DO_NOT_CONTACT");
    expect(action.primaryAction).toBe("NONE");
    expect(action.titleKey).toBe("doNotContact");
  });

  it("overdue callback carries due time, overdue duration and the task", () => {
    const action = computeNextAction(
      lead({
        status: LeadStatus.CALLBACK,
        callbackAt: new Date("2026-08-04T10:00:00Z"),
        openTasks: [task({})],
      }),
      NOW
    );
    expect(action.type).toBe("CALLBACK_OVERDUE");
    expect(action.priority).toBe(1);
    expect(action.overdueMs).toBe(2 * 3_600_000);
    expect(action.relatedTaskId).toBe("task-1");
    expect(action.primaryAction).toBe("CALL");
  });

  it("prefers the open callback task's dueAt over the denormalized field", () => {
    const action = computeNextAction(
      lead({
        status: LeadStatus.CALLBACK,
        callbackAt: new Date("2026-08-04T08:00:00Z"),
        openTasks: [task({ dueAt: new Date("2026-08-05T08:00:00Z") })],
      }),
      NOW
    );
    expect(action.type).toBe("CALLBACK_DUE");
    expect(action.dueAt).toEqual(new Date("2026-08-05T08:00:00Z"));
  });

  it("future callback is due, not overdue", () => {
    const action = computeNextAction(
      lead({ status: LeadStatus.CALLBACK, callbackAt: new Date("2026-08-05T10:00:00Z") }),
      NOW
    );
    expect(action.type).toBe("CALLBACK_DUE");
    expect(action.overdueMs).toBeNull();
  });

  it("upcoming appointment is announced", () => {
    const action = computeNextAction(
      lead({ status: LeadStatus.APPOINTMENT, appointmentAt: new Date("2026-08-05T08:30:00Z") }),
      NOW
    );
    expect(action.type).toBe("APPOINTMENT_UPCOMING");
    expect(action.dueAt).toEqual(new Date("2026-08-05T08:30:00Z"));
  });

  it("overdue non-callback task surfaces as TASK_OVERDUE", () => {
    const action = computeNextAction(
      lead({
        openTasks: [
          task({ id: "doc", type: TaskType.DOCUMENT_REQUEST, dueAt: new Date("2026-08-04T08:00:00Z") }),
        ],
      }),
      NOW
    );
    expect(action.type).toBe("TASK_OVERDUE");
    expect(action.relatedTaskId).toBe("doc");
    expect(action.overdueMs).toBe(4 * 3_600_000);
  });

  it("completed/cancelled tasks are ignored", () => {
    const action = computeNextAction(
      lead({
        openTasks: [
          task({ status: TaskStatus.COMPLETED, dueAt: new Date("2026-08-04T08:00:00Z") }),
        ],
      }),
      NOW
    );
    expect(action.type).not.toBe("TASK_OVERDUE");
  });

  it("third no-answer escalates", () => {
    const action = computeNextAction(lead({ status: LeadStatus.NO_ANSWER_3 }), NOW);
    expect(action.type).toBe("THIRD_NO_ANSWER");
    expect(action.escalation).toBe(true);
  });

  it("new leads should be called now", () => {
    const action = computeNextAction(lead({ status: LeadStatus.NEW }), NOW);
    expect(action.type).toBe("NEW_LEAD");
    expect(action.titleKey).toBe("callNow");
  });

  it("stale leads report inactivity", () => {
    const action = computeNextAction(
      lead({ lastActivityAt: new Date("2026-07-28T09:00:00Z") }),
      NOW
    );
    expect(action.type).toBe("STALE");
    expect(action.titleKey).toBe("noActivity");
  });

  it("active lead without any schedule demands a next action", () => {
    const action = computeNextAction(lead({}), NOW);
    expect(action.type).toBe("NO_NEXT_ACTION");
    expect(action.primaryAction).toBe("SCHEDULE");
    expect(action.titleKey).toBe("noNextAction");
  });

  it("terminal leads need no action", () => {
    expect(computeNextAction(lead({ status: LeadStatus.CONVERTED }), NOW).type).toBe("CONVERTED");
    expect(computeNextAction(lead({ status: LeadStatus.REJECTED }), NOW).type).toBe("TERMINAL");
    expect(computeNextAction(lead({ status: LeadStatus.WRONG_NUMBER }), NOW).type).toBe(
      "TERMINAL"
    );
  });

  it("is deterministic for identical inputs", () => {
    const input = lead({ status: LeadStatus.CALLBACK, callbackAt: new Date("2026-08-04T10:00:00Z") });
    expect(computeNextAction(input, NOW)).toEqual(computeNextAction(input, NOW));
  });
});
