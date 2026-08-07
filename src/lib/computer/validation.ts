/**
 * Computer C4.1 — controlled execution validation.
 *
 * Pure taxonomy and aggregation. C4.1 gathers EVIDENCE about the C4
 * primitive; it grants no new browser authority and captures no page
 * content. Everything here operates on ids, enums, booleans, counts and
 * coarse duration buckets derived from ordinary Operanto domain state —
 * there is no separate analytics store and no third-party telemetry.
 *
 * Privacy rule for this whole module: nothing may accept, compute over, or
 * emit page text, titles, URLs, query strings, fragments, element names,
 * customer names, goals, prompts or model responses.
 */

/**
 * The stable, bounded failure taxonomy. Arbitrary exception messages are
 * NEVER used as analytics dimensions — a refusal maps to exactly one of
 * these or it is not recorded.
 */
export const VALIDATION_FAILURES = [
  "STALE_SNAPSHOT",
  "AMBIGUOUS_TARGET",
  "TARGET_NOT_FOUND",
  "TARGET_CHANGED",
  "POLICY_REJECTED",
  "APPROVAL_EXPIRED",
  "ACTION_EXPIRED",
  "BRIDGE_DETACHED",
  "ORIGIN_CHANGED",
  "EXTENSION_REJECTED",
  "NAVIGATION_FAILED",
  "VERIFICATION_INCONCLUSIVE",
  "VERIFICATION_FAILED",
  "USER_REJECTED",
  "USER_CANCELLED",
  "WRONG_RECOMMENDATION",
  "REPLAYED_CREDENTIAL",
  "WRONG_TENANT_OR_SESSION",
  "NOT_ENABLED",
] as const;

export type ValidationFailure = (typeof VALIDATION_FAILURES)[number];

/** The human usefulness signal — deliberately three coarse values. */
export const VALIDATION_ASSESSMENTS = [
  "USEFUL",
  "NOT_USEFUL",
  "WRONG_RECOMMENDATION",
] as const;

export type ValidationAssessment = (typeof VALIDATION_ASSESSMENTS)[number];

export function isValidationAssessment(
  value: string,
): value is ValidationAssessment {
  return (VALIDATION_ASSESSMENTS as readonly string[]).includes(value);
}

/**
 * Coarse duration buckets. Deliberately not raw millisecond series: a
 * precise timing trace across a customer's session is itself a weak side
 * channel, and coarse buckets answer "is this usable?" just as well.
 */
export const DURATION_BUCKETS = [
  "LT_5S",
  "S5_30",
  "S30_2M",
  "M2_10",
  "GT_10M",
] as const;

export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export function durationBucket(ms: number): DurationBucket {
  if (ms < 5_000) return "LT_5S";
  if (ms < 30_000) return "S5_30";
  if (ms < 120_000) return "S30_2M";
  if (ms < 600_000) return "M2_10";
  return "GT_10M";
}

/** Non-content facts about one guide recommendation. */
export type RecommendationFact = {
  /** Did deterministic grounding bind the suggestion to a real element? */
  boundTarget: boolean;
  /** capture → recommendation, when both timestamps are known. */
  captureToRecommendationMs: number | null;
};

/** Non-content facts about one OPEN_SAFE_LINK action. */
export type NavigationFact = {
  status: string;
  verificationResult: string;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | null;
  proposedToDecisionMs: number | null;
  approvalToVerifiedMs: number | null;
  /** True when the action reached the extension (credential claimed). */
  claimed: boolean;
  /** True when the extension reported a completed navigation. */
  executed: boolean;
};

export type ValidationInput = {
  recommendations: RecommendationFact[];
  navigations: NavigationFact[];
  /** Refusal reasons harvested from audit events (enums only). */
  failures: ValidationFailure[];
  assessments: ValidationAssessment[];
  /** Safe-link candidates dropped by policy at capture time. */
  droppedLinkCount: number;
  /**
   * Invariant breaches, counted by the SERVICE from domain state — never
   * inferred here. These must all be zero; a blocked attempt is NOT a
   * breach (it is the protection working), so refusal counts never feed
   * these numbers.
   */
  invariantBreaches: {
    unauthorizedSideEffects: number;
    crossOriginEscapes: number;
    replaySuccesses: number;
    sensitiveUrlPersistence: number;
  };
};

export type ValidationReport = {
  recommendations: {
    total: number;
    withBoundTarget: number;
    boundTargetRate: number | null;
    captureToRecommendation: Record<DurationBucket, number>;
  };
  navigations: {
    proposed: number;
    approved: number;
    rejected: number;
    cancelled: number;
    claimed: number;
    executed: number;
    verified: number;
    inconclusive: number;
    failed: number;
    approvalAgreementRate: number | null;
    verificationRate: number | null;
    proposalToDecision: Record<DurationBucket, number>;
    approvalToVerification: Record<DurationBucket, number>;
  };
  failures: Record<ValidationFailure, number>;
  assessments: Record<ValidationAssessment, number>;
  droppedLinkCount: number;
  /** Invariants that MUST stay at zero for C5 to be considerable. */
  invariants: {
    unauthorizedSideEffects: number;
    crossOriginEscapes: number;
    replaySuccesses: number;
    sensitiveUrlPersistence: number;
  };
};

function emptyBuckets(): Record<DurationBucket, number> {
  return { LT_5S: 0, S5_30: 0, S30_2M: 0, M2_10: 0, GT_10M: 0 };
}

/** Rate helper — returns null rather than inventing a percentage from 0/0. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function buildValidationReport(input: ValidationInput): ValidationReport {
  const captureToRecommendation = emptyBuckets();
  let withBoundTarget = 0;
  for (const rec of input.recommendations) {
    if (rec.boundTarget) withBoundTarget += 1;
    if (rec.captureToRecommendationMs !== null) {
      captureToRecommendation[durationBucket(rec.captureToRecommendationMs)] += 1;
    }
  }

  const proposalToDecision = emptyBuckets();
  const approvalToVerification = emptyBuckets();
  let approved = 0;
  let rejected = 0;
  let cancelled = 0;
  let claimed = 0;
  let executed = 0;
  let verified = 0;
  let inconclusive = 0;
  let failed = 0;
  for (const nav of input.navigations) {
    if (nav.approvalStatus === "APPROVED") approved += 1;
    if (nav.approvalStatus === "REJECTED") rejected += 1;
    if (nav.approvalStatus === "CANCELLED" || nav.status === "CANCELLED") cancelled += 1;
    if (nav.claimed) claimed += 1;
    if (nav.executed) executed += 1;
    if (nav.verificationResult === "VERIFIED") verified += 1;
    if (nav.verificationResult === "INCONCLUSIVE") inconclusive += 1;
    if (nav.verificationResult === "FAILED") failed += 1;
    if (nav.proposedToDecisionMs !== null) {
      proposalToDecision[durationBucket(nav.proposedToDecisionMs)] += 1;
    }
    if (nav.approvalToVerifiedMs !== null) {
      approvalToVerification[durationBucket(nav.approvalToVerifiedMs)] += 1;
    }
  }

  const failures = Object.fromEntries(
    VALIDATION_FAILURES.map((key) => [key, 0]),
  ) as Record<ValidationFailure, number>;
  for (const failure of input.failures) failures[failure] += 1;

  const assessments = Object.fromEntries(
    VALIDATION_ASSESSMENTS.map((key) => [key, 0]),
  ) as Record<ValidationAssessment, number>;
  for (const assessment of input.assessments) assessments[assessment] += 1;

  const decided = approved + rejected;

  return {
    recommendations: {
      total: input.recommendations.length,
      withBoundTarget,
      boundTargetRate: rate(withBoundTarget, input.recommendations.length),
      captureToRecommendation,
    },
    navigations: {
      proposed: input.navigations.length,
      approved,
      rejected,
      cancelled,
      claimed,
      executed,
      verified,
      inconclusive,
      failed,
      // Agreement is measured over DECIDED proposals only — pending ones
      // are not evidence either way.
      approvalAgreementRate: rate(approved, decided),
      // Verification rate is measured over EXECUTED navigations: a proposal
      // the human never approved says nothing about verification.
      verificationRate: rate(verified, executed),
      proposalToDecision,
      approvalToVerification,
    },
    failures,
    assessments,
    droppedLinkCount: input.droppedLinkCount,
    // Any nonzero value is a hard stop for the C5 review.
    invariants: input.invariantBreaches,
  };
}
