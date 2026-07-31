import { describe, it, expect } from "vitest";
import {
  conditionSchema,
  actionSchema,
  automationConfigSchema,
} from "@/lib/automations/schema";

describe("conditionSchema", () => {
  it("accepts a valid intent condition", () => {
    expect(conditionSchema.safeParse({ field: "intent", value: "pricing_inquiry" }).success).toBe(
      true,
    );
  });

  it("rejects an intent value outside the enum", () => {
    expect(conditionSchema.safeParse({ field: "intent", value: "buy_now" }).success).toBe(false);
  });

  it("bounds leadScoreGte to 0–100 integers", () => {
    expect(conditionSchema.safeParse({ field: "leadScoreGte", value: 70 }).success).toBe(true);
    expect(conditionSchema.safeParse({ field: "leadScoreGte", value: 101 }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "leadScoreGte", value: 12.5 }).success).toBe(false);
  });

  it("requires a non-empty messageContains string", () => {
    expect(conditionSchema.safeParse({ field: "messageContains", value: "" }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "messageContains", value: "refund" }).success).toBe(
      true,
    );
  });
});

describe("actionSchema", () => {
  it("accepts each supported action type", () => {
    expect(actionSchema.safeParse({ type: "add_tag", tagId: "t1" }).success).toBe(true);
    expect(actionSchema.safeParse({ type: "set_priority", priority: "high" }).success).toBe(true);
    expect(actionSchema.safeParse({ type: "assign", userId: "u1" }).success).toBe(true);
    expect(actionSchema.safeParse({ type: "create_task", title: "Follow up" }).success).toBe(true);
  });

  it("rejects an unknown action type", () => {
    expect(actionSchema.safeParse({ type: "send_sms", to: "+1" }).success).toBe(false);
  });

  it("rejects set_priority with an invalid priority", () => {
    expect(actionSchema.safeParse({ type: "set_priority", priority: "critical" }).success).toBe(
      false,
    );
  });
});

describe("automationConfigSchema", () => {
  it("requires at least one action", () => {
    const r = automationConfigSchema.safeParse({ conditions: [], actions: [] });
    expect(r.success).toBe(false);
  });

  it("accepts zero conditions with one action (an unconditional rule)", () => {
    const r = automationConfigSchema.safeParse({
      conditions: [],
      actions: [{ type: "set_priority", priority: "high" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a full rule with multiple conditions and actions", () => {
    const r = automationConfigSchema.safeParse({
      conditions: [
        { field: "intent", value: "pricing_inquiry" },
        { field: "leadScoreGte", value: 70 },
      ],
      actions: [
        { type: "set_priority", priority: "high" },
        { type: "create_task", title: "Follow up on quote" },
      ],
    });
    expect(r.success).toBe(true);
  });
});
