import { describe, it, expect } from "vitest";
import { evaluateRules, ruleDefinitionSchema, type RuleInput } from "./business-rules";

const rule = (name: string, priority: number, definition: unknown): RuleInput => ({ name, priority, definition });

describe("ruleDefinitionSchema", () => {
  it("accepts a valid pricing modifier", () => {
    expect(
      ruleDefinitionSchema.safeParse({ type: "pricing_modifier", label: "x", kind: "discount", percent: 10 }).success,
    ).toBe(true);
  });
  it("rejects a pricing modifier with neither percent nor amount", () => {
    expect(ruleDefinitionSchema.safeParse({ type: "pricing_modifier", label: "x", kind: "discount" }).success).toBe(false);
  });
});

describe("evaluateRules", () => {
  it("applies a percentage discount as a negative adjustment", () => {
    const r = evaluateRules(
      [rule("Spring", 0, { type: "pricing_modifier", label: "Spring 10%", kind: "discount", percent: 10 })],
      { subtotal: 200 },
    );
    expect(r.adjustments).toEqual([{ label: "Spring 10%", amount: -20 }]);
    expect(r.totalAdjustment).toBe(-20);
    expect(r.violations).toEqual([]);
  });

  it("applies a fixed surcharge as a positive adjustment", () => {
    const r = evaluateRules(
      [rule("Rush", 0, { type: "pricing_modifier", label: "Rush fee", kind: "surcharge", amount: 25 })],
      { subtotal: 100 },
    );
    expect(r.adjustments[0]).toEqual({ label: "Rush fee", amount: 25 });
  });

  it("flags a below-minimum order", () => {
    const r = evaluateRules([rule("Min", 0, { type: "min_order", amount: 100 })], { subtotal: 60 });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatch(/below the minimum/);
  });

  it("flags an out-of-area location", () => {
    const r = evaluateRules(
      [rule("Area", 0, { type: "service_area", regions: ["Prishtina"] })],
      { subtotal: 100, location: "Berlin, Germany" },
    );
    expect(r.violations).toHaveLength(1);
  });

  it("flags missing required requirement keys", () => {
    const r = evaluateRules(
      [rule("Elig", 0, { type: "eligibility", requireRequirementKeys: ["location", "item_count"] })],
      { subtotal: 100, providedRequirementKeys: ["item_count"] },
    );
    expect(r.violations[0]).toMatch(/location/);
  });

  it("ignores rules with an invalid definition", () => {
    const r = evaluateRules([rule("Bad", 0, { type: "pricing_modifier", label: "x", kind: "discount" })], { subtotal: 100 });
    expect(r.adjustments).toEqual([]);
    expect(r.violations).toEqual([]);
  });
});
