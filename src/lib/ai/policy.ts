import type { AIRiskLevel } from "@prisma/client";

/**
 * Confidence and risk policy (version v1) — pure and unit-tested, enforced
 * SERVER-SIDE at decision time. UI badges are presentation; this module is
 * the control. See docs/operanto-ai-handover.md for the policy text.
 *
 * No confidence level and no risk level ever permits autonomous sending —
 * approval only ever admits a draft into the MANUAL message flow.
 */

export const CONFIDENCE_POLICY_VERSION = "v1";

export const LOW_CONFIDENCE_THRESHOLD = 0.5;
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;

export function isLowConfidence(confidence: number | null | undefined): boolean {
  return typeof confidence === "number" && confidence < LOW_CONFIDENCE_THRESHOLD;
}

export function confidenceBand(
  confidence: number | null | undefined,
): "low" | "normal" | "high" | "unknown" {
  if (typeof confidence !== "number") return "unknown";
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "low";
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  return "normal";
}

export type ApprovalPolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * May this draft be APPROVED? BLOCKED risk never; low confidence only with
 * the reviewer's explicit acknowledgement.
 */
export function canApproveDraft(input: {
  riskLevel: AIRiskLevel;
  lowConfidence: boolean;
  acknowledgeLowConfidence: boolean;
}): ApprovalPolicyVerdict {
  if (input.riskLevel === "BLOCKED") {
    return {
      allowed: false,
      reason: "BLOCKED output cannot be approved under any circumstances",
    };
  }
  if (input.lowConfidence && !input.acknowledgeLowConfidence) {
    return {
      allowed: false,
      reason:
        "Low-confidence output requires explicit reviewer acknowledgement before approval",
    };
  }
  return { allowed: true };
}

/**
 * Documented cost estimation table, cents per 1M tokens. Estimates only —
 * marked as such everywhere they surface. Isolated here so a real billing
 * source can replace it without touching domain logic.
 */
const ESTIMATED_COST_PER_MILLION_CENTS: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-4o-mini": { input: 15, output: 60 },
  "gpt-4o": { input: 250, output: 1000 },
};

export function estimateCostCents(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const table = ESTIMATED_COST_PER_MILLION_CENTS[model];
  if (!table || inputTokens === null || outputTokens === null) return null;
  const cents =
    (inputTokens * table.input + outputTokens * table.output) / 1_000_000;
  return Math.ceil(cents);
}
