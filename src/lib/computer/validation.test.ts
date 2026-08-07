import { describe, expect, it } from "vitest";
import {
  VALIDATION_ASSESSMENTS,
  VALIDATION_FAILURES,
  buildValidationReport,
  durationBucket,
  isValidationAssessment,
  rate,
  type ValidationInput,
} from "@/lib/computer/validation";

/**
 * C4.1 aggregation. The important properties are honesty ones: rates are
 * null rather than invented when there is no data, denominators are the
 * defensible ones, and the failure vocabulary stays closed.
 */

const CLEAN: ValidationInput = {
  recommendations: [],
  navigations: [],
  failures: [],
  assessments: [],
  droppedLinkCount: 0,
  invariantBreaches: {
    unauthorizedSideEffects: 0,
    crossOriginEscapes: 0,
    replaySuccesses: 0,
    sensitiveUrlPersistence: 0,
  },
};

function nav(over: Partial<ValidationInput["navigations"][number]> = {}) {
  return {
    status: "EXECUTED",
    verificationResult: "VERIFIED",
    approvalStatus: "APPROVED" as const,
    proposedToDecisionMs: 20_000,
    approvalToVerifiedMs: 4_000,
    claimed: true,
    executed: true,
    ...over,
  };
}

describe("rate honesty", () => {
  it("returns null instead of inventing a percentage from no data", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 4)).toBe(75);
    expect(rate(1, 3)).toBe(33.3);
  });

  it("an empty campaign reports null rates, not 0% or 100%", () => {
    const report = buildValidationReport(CLEAN);
    expect(report.recommendations.boundTargetRate).toBeNull();
    expect(report.navigations.approvalAgreementRate).toBeNull();
    expect(report.navigations.verificationRate).toBeNull();
  });
});

describe("denominators", () => {
  it("approval agreement counts DECIDED proposals only (pending excluded)", () => {
    const report = buildValidationReport({
      ...CLEAN,
      navigations: [
        nav(),
        nav({ approvalStatus: "REJECTED", executed: false, claimed: false }),
        nav({ approvalStatus: "PENDING", executed: false, claimed: false }),
      ],
    });
    // 1 approved of 2 decided → 50%, not 33.3% of all three.
    expect(report.navigations.approvalAgreementRate).toBe(50);
  });

  it("verification rate counts EXECUTED navigations only", () => {
    const report = buildValidationReport({
      ...CLEAN,
      navigations: [
        nav(),
        nav({ verificationResult: "INCONCLUSIVE" }),
        // Never approved → says nothing about verification.
        nav({ approvalStatus: "REJECTED", executed: false, claimed: false, verificationResult: "NOT_RUN" }),
      ],
    });
    expect(report.navigations.executed).toBe(2);
    expect(report.navigations.verificationRate).toBe(50);
  });
});

describe("duration buckets", () => {
  it("maps to coarse buckets, never raw timings", () => {
    expect(durationBucket(1_000)).toBe("LT_5S");
    expect(durationBucket(10_000)).toBe("S5_30");
    expect(durationBucket(60_000)).toBe("S30_2M");
    expect(durationBucket(300_000)).toBe("M2_10");
    expect(durationBucket(3_600_000)).toBe("GT_10M");
  });

  it("tallies buckets for both durations", () => {
    const report = buildValidationReport({
      ...CLEAN,
      recommendations: [
        { boundTarget: true, captureToRecommendationMs: 2_000 },
        { boundTarget: false, captureToRecommendationMs: null },
      ],
      navigations: [nav()],
    });
    expect(report.recommendations.captureToRecommendation.LT_5S).toBe(1);
    expect(report.recommendations.withBoundTarget).toBe(1);
    expect(report.navigations.proposalToDecision.S5_30).toBe(1);
    expect(report.navigations.approvalToVerification.LT_5S).toBe(1);
  });
});

describe("failure and assessment vocabularies stay closed", () => {
  it("every taxonomy key is present and zeroed by default", () => {
    const report = buildValidationReport(CLEAN);
    for (const key of VALIDATION_FAILURES) expect(report.failures[key]).toBe(0);
    for (const key of VALIDATION_ASSESSMENTS) expect(report.assessments[key]).toBe(0);
  });

  it("counts only known values", () => {
    const report = buildValidationReport({
      ...CLEAN,
      failures: ["STALE_SNAPSHOT", "STALE_SNAPSHOT", "REPLAYED_CREDENTIAL"],
      assessments: ["USEFUL", "USEFUL", "WRONG_RECOMMENDATION"],
    });
    expect(report.failures.STALE_SNAPSHOT).toBe(2);
    expect(report.failures.REPLAYED_CREDENTIAL).toBe(1);
    expect(report.assessments.USEFUL).toBe(2);
  });

  it("rejects unknown assessment strings", () => {
    expect(isValidationAssessment("USEFUL")).toBe(true);
    expect(isValidationAssessment("VERY_USEFUL")).toBe(false);
    expect(isValidationAssessment("")).toBe(false);
  });
});

describe("invariants", () => {
  it("are passed through from the service, never inferred from refusals", () => {
    // A blocked cross-origin attempt is the protection WORKING; it must
    // not be reported as an escape.
    const report = buildValidationReport({
      ...CLEAN,
      failures: ["ORIGIN_CHANGED", "ORIGIN_CHANGED"],
    });
    expect(report.failures.ORIGIN_CHANGED).toBe(2);
    expect(report.invariants.crossOriginEscapes).toBe(0);
  });

  it("surfaces a genuine breach when the service reports one", () => {
    const report = buildValidationReport({
      ...CLEAN,
      invariantBreaches: {
        unauthorizedSideEffects: 1,
        crossOriginEscapes: 0,
        replaySuccesses: 0,
        sensitiveUrlPersistence: 0,
      },
    });
    expect(report.invariants.unauthorizedSideEffects).toBe(1);
  });
});
