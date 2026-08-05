import { describe, expect, it } from "vitest";
import {
  CALLBACK_TASK_TYPE,
  DEFAULT_TASK_REMINDER_MINUTES,
  OPEN_CALLBACK_STATUSES,
  callbackPriorityFor,
  planCallbackUpsert,
} from "./callbacks";

describe("callback invariant rules", () => {
  it("defines open exactly as OPEN or IN_PROGRESS", () => {
    expect([...OPEN_CALLBACK_STATUSES]).toEqual(["OPEN", "IN_PROGRESS"]);
    expect(CALLBACK_TASK_TYPE).toBe("CALLBACK");
    expect(DEFAULT_TASK_REMINDER_MINUTES).toBe(15);
  });

  it("prioritizes promises over retries", () => {
    expect(callbackPriorityFor("CALLBACK")).toBe("HIGH");
    expect(callbackPriorityFor("RETRY")).toBe("NORMAL");
  });

  it("always upserts — reschedules the one open task, else creates the first", () => {
    const due = new Date("2026-08-06T10:00:00Z");
    expect(planCallbackUpsert("task_1", due)).toEqual({
      action: "reschedule",
      taskId: "task_1",
      dueAt: due,
    });
    expect(planCallbackUpsert(null, due)).toEqual({ action: "create", dueAt: due });
    expect(planCallbackUpsert(undefined, due)).toEqual({ action: "create", dueAt: due });
  });
});
