import { describe, it, expect } from "vitest";
import { requirementProgress, type RequirementLike } from "./opportunity-progress";

const r = (
  label: string,
  status: RequirementLike["status"],
  required = true,
): RequirementLike => ({ label, status, required });

describe("requirementProgress", () => {
  it("is complete with no requirements", () => {
    const p = requirementProgress([]);
    expect(p.complete).toBe(true);
    expect(p.missingRequired).toEqual([]);
    expect(p.total).toBe(0);
  });

  it("is complete when all required facts are provided", () => {
    const p = requirementProgress([r("A", "provided"), r("B", "provided")]);
    expect(p.complete).toBe(true);
    expect(p.requiredProvided).toBe(2);
    expect(p.requiredTotal).toBe(2);
  });

  it("flags a missing required fact by label", () => {
    const p = requirementProgress([r("A", "provided"), r("B", "missing")]);
    expect(p.complete).toBe(false);
    expect(p.missingRequired).toEqual(["B"]);
    expect(p.requiredProvided).toBe(1);
  });

  it("does not let an optional missing fact block completeness", () => {
    const p = requirementProgress([r("A", "provided"), r("Budget", "missing", false)]);
    expect(p.complete).toBe(true);
    expect(p.missingRequired).toEqual([]);
    expect(p.provided).toBe(1);
    expect(p.total).toBe(2);
  });

  it("counts provided across required and optional", () => {
    const p = requirementProgress([
      r("A", "provided"),
      r("B", "provided", false),
      r("C", "missing"),
    ]);
    expect(p.provided).toBe(2);
    expect(p.missingRequired).toEqual(["C"]);
  });
});
