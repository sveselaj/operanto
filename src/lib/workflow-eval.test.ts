import { describe, it, expect } from "vitest";
import { evaluateWorkflow, type StepLite } from "./workflow-eval";

const steps: StepLite[] = [
  { key: "collect", name: "Collect", order: 0, requiredRequirementKeys: ["a", "b"] },
  { key: "quote", name: "Quote", order: 1, requiredRequirementKeys: [] },
  { key: "won", name: "Won", order: 2, requiredRequirementKeys: [] },
];

describe("evaluateWorkflow", () => {
  it("blocks advance while required keys are missing", () => {
    const e = evaluateWorkflow(steps, "collect", ["a"]);
    expect(e.currentStep?.key).toBe("collect");
    expect(e.missingKeys).toEqual(["b"]);
    expect(e.canAdvance).toBe(false);
    expect(e.nextStep?.key).toBe("quote");
    expect(e.isLastStep).toBe(false);
  });

  it("allows advance when all required keys are provided", () => {
    const e = evaluateWorkflow(steps, "collect", ["a", "b", "extra"]);
    expect(e.canAdvance).toBe(true);
    expect(e.nextStep?.key).toBe("quote");
  });

  it("a step with no required keys can always advance", () => {
    const e = evaluateWorkflow(steps, "quote", []);
    expect(e.canAdvance).toBe(true);
    expect(e.nextStep?.key).toBe("won");
  });

  it("marks the last step and has no next", () => {
    const e = evaluateWorkflow(steps, "won", []);
    expect(e.isLastStep).toBe(true);
    expect(e.nextStep).toBeNull();
    expect(e.canAdvance).toBe(true);
  });

  it("returns no current step for an unknown key", () => {
    const e = evaluateWorkflow(steps, "nope", []);
    expect(e.currentStep).toBeNull();
    expect(e.canAdvance).toBe(false);
  });

  it("sorts steps by order regardless of input order", () => {
    const shuffled = [steps[2], steps[0], steps[1]];
    const e = evaluateWorkflow(shuffled, "collect", ["a", "b"]);
    expect(e.nextStep?.key).toBe("quote");
  });
});
