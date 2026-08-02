import { describe, expect, it } from "vitest";
import {
  canApproveDraft,
  confidenceBand,
  estimateCostCents,
  isLowConfidence,
} from "@/lib/ai/policy";

describe("confidence policy v1", () => {
  it("bands confidence at the documented thresholds", () => {
    expect(confidenceBand(0.49)).toBe("low");
    expect(confidenceBand(0.5)).toBe("normal");
    expect(confidenceBand(0.79)).toBe("normal");
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(null)).toBe("unknown");
    expect(isLowConfidence(0.49)).toBe(true);
    expect(isLowConfidence(0.5)).toBe(false);
    expect(isLowConfidence(null)).toBe(false);
  });
});

describe("approval policy", () => {
  it("BLOCKED can never be approved, regardless of acknowledgement", () => {
    for (const acknowledge of [true, false]) {
      const verdict = canApproveDraft({
        riskLevel: "BLOCKED",
        lowConfidence: false,
        acknowledgeLowConfidence: acknowledge,
      });
      expect(verdict.allowed).toBe(false);
    }
  });

  it("low confidence requires explicit acknowledgement", () => {
    expect(
      canApproveDraft({
        riskLevel: "MEDIUM",
        lowConfidence: true,
        acknowledgeLowConfidence: false,
      }).allowed,
    ).toBe(false);
    expect(
      canApproveDraft({
        riskLevel: "MEDIUM",
        lowConfidence: true,
        acknowledgeLowConfidence: true,
      }).allowed,
    ).toBe(true);
  });

  it("normal drafts approve under normal review", () => {
    expect(
      canApproveDraft({
        riskLevel: "HIGH",
        lowConfidence: false,
        acknowledgeLowConfidence: false,
      }).allowed,
    ).toBe(true);
  });
});

describe("estimated cost table", () => {
  it("estimates known models and refuses unknown ones", () => {
    expect(estimateCostCents("gpt-4o-mini", 1_000_000, 1_000_000)).toBe(75);
    expect(estimateCostCents("unknown-model", 1000, 1000)).toBeNull();
    expect(estimateCostCents("gpt-4o-mini", null, 10)).toBeNull();
  });
});
