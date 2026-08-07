import { z } from "zod";
import type {
  AIRiskLevel,
  ComputerActionStatus,
  ComputerActionType,
  ComputerRiskTier,
  ComputerSessionStatus,
} from "@prisma/client";

/**
 * Computer C1 policy — pure and deterministic, like src/lib/ai/policy.ts.
 *
 * Everything here is enforced SERVER-SIDE by src/lib/services/computer.ts.
 * Two invariants this module carries for the whole capability:
 *
 * - Risk is never below the floor its action type implies, and R4_RESTRICTED
 *   is born BLOCKED: no approval path to it exists, in any slice. The human
 *   performs the final act (C0 ADR §7).
 * - Confidence is never authorization. It feeds the existing low-confidence
 *   acknowledgement flow on ApprovalRequest and nothing else; no confidence
 *   value skips RBAC, policy or approval.
 */

export const COMPUTER_RISK_ORDER: Record<ComputerRiskTier, number> = {
  R0_OBSERVE: 0,
  R1_NAVIGATE: 1,
  R2_PREPARE: 2,
  R3_COMMIT: 3,
  R4_RESTRICTED: 4,
};

/**
 * The MINIMUM tier an action type can be classified at. A floor, not an
 * assignment: a CLICK that commits business state must be proposed as
 * R3_COMMIT by the proposer — but no proposer can call SUBMIT "navigation".
 */
export const COMPUTER_RISK_FLOOR: Record<ComputerActionType, ComputerRiskTier> = {
  OBSERVE: "R0_OBSERVE",
  EXTRACT: "R0_OBSERVE",
  NAVIGATE: "R1_NAVIGATE",
  SCROLL: "R1_NAVIGATE",
  CLICK: "R1_NAVIGATE",
  DOWNLOAD: "R1_NAVIGATE",
  TYPE: "R2_PREPARE",
  SELECT: "R2_PREPARE",
  UPLOAD: "R2_PREPARE",
  SUBMIT: "R3_COMMIT",
};

export function meetsRiskFloor(
  actionType: ComputerActionType,
  tier: ComputerRiskTier,
): boolean {
  return (
    COMPUTER_RISK_ORDER[tier] >=
    COMPUTER_RISK_ORDER[COMPUTER_RISK_FLOOR[actionType]]
  );
}

/**
 * Mapping onto the AIRiskLevel snapshot that ApprovalRequest carries.
 * Documented in the C0 ADR: R0/R1 → LOW, R2 → MEDIUM, R3 → HIGH,
 * R4 → BLOCKED — and BLOCKED can never be approved (canApproveDraft), so
 * even a hand-crafted approval row for an R4 action would be undecidable.
 */
export function approvalRiskLevelFor(tier: ComputerRiskTier): AIRiskLevel {
  switch (tier) {
    case "R0_OBSERVE":
    case "R1_NAVIGATE":
      return "LOW";
    case "R2_PREPARE":
      return "MEDIUM";
    case "R3_COMMIT":
      return "HIGH";
    case "R4_RESTRICTED":
      return "BLOCKED";
  }
}

/** R3_COMMIT always gates through the unified ApprovalRequest. */
export function requiresApproval(tier: ComputerRiskTier): boolean {
  return tier === "R3_COMMIT";
}

/**
 * The status a freshly proposed action is born with. R4 is BLOCKED at birth
 * (terminal — Computer never executes it); R3 waits for the unified approval
 * gate; everything else is a plain proposal.
 */
export function initialActionStatusFor(
  tier: ComputerRiskTier,
): ComputerActionStatus {
  if (tier === "R4_RESTRICTED") return "BLOCKED";
  if (tier === "R3_COMMIT") return "APPROVAL_PENDING";
  return "PROPOSED";
}

/** ApprovalRequest.actionType for a Computer action, e.g. "computer.submit". */
export function computerApprovalActionType(
  actionType: ComputerActionType,
): string {
  return `computer.${actionType.toLowerCase()}`;
}

/* ── Lifecycle ──────────────────────────────────────────────────────── */

/**
 * Legal session transitions. There is deliberately no ACTIVE and no
 * EXECUTING anywhere in C1 — no state may pretend execution happened.
 * COMPLETED/FAILED are HUMAN-recorded conclusions reachable only from READY
 * through concludeComputerSession. Approval-waiting is an ACTION-level fact
 * (APPROVAL_PENDING), never duplicated as session state.
 */
export const COMPUTER_SESSION_TRANSITIONS: Record<
  ComputerSessionStatus,
  ComputerSessionStatus[]
> = {
  CREATED: ["PLANNING", "CANCELLED"],
  PLANNING: ["READY", "CANCELLED"],
  READY: ["PLANNING", "COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionSession(
  from: ComputerSessionStatus,
  to: ComputerSessionStatus,
): boolean {
  return COMPUTER_SESSION_TRANSITIONS[from].includes(to);
}

export const OPEN_SESSION_STATUSES: ComputerSessionStatus[] = [
  "CREATED",
  "PLANNING",
  "READY",
];

/** Session states in which a (new) plan may be proposed. */
export const PLAN_PROPOSABLE_SESSION_STATUSES: ComputerSessionStatus[] = [
  "CREATED",
  "PLANNING",
  "READY",
];

/** Session states in which an action may be proposed (a plan exists). */
export const ACTION_PROPOSABLE_SESSION_STATUSES: ComputerSessionStatus[] = [
  "PLANNING",
  "READY",
];

export const CANCELLABLE_ACTION_STATUSES: ComputerActionStatus[] = [
  "PROPOSED",
  "APPROVAL_PENDING",
  "APPROVED",
];

/**
 * Verification may be recorded once, on an action a human could have carried
 * out: an open proposal (R0–R2) or an APPROVED commit. Never on
 * APPROVAL_PENDING (nothing may treat an unapproved R3 as executable),
 * never on BLOCKED/REJECTED/CANCELLED.
 */
export const VERIFIABLE_ACTION_STATUSES: ComputerActionStatus[] = [
  "PROPOSED",
  "APPROVED",
];

/* ── Validation bounds (service-enforced) ───────────────────────────── */

export const COMPUTER_LIMITS = {
  goal: 1000,
  outcomeNote: 1000,
  planSummary: 2000,
  stepTitle: 300,
  stepsPerPlan: 40,
  actionReason: 1000,
  verificationNote: 1000,
  snapshotUrl: 2000,
  snapshotTitle: 500,
  snapshotText: 4000,
  semanticElements: 200,
} as const;

export function isValidConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Semantic target descriptor for a proposed action — role/accessible-name
 * addressing per the C0 observation model. `.strict()` so nothing beyond
 * these keys can be persisted: no coordinates-as-primary, no element VALUES,
 * no credential-shaped payloads, no free page dumps.
 */
export const computerTargetSchema = z
  .object({
    kind: z.literal("semantic"),
    role: z.string().min(1).max(60).optional(),
    name: z.string().min(1).max(300).optional(),
    urlPattern: z.string().min(1).max(500).optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((t) => t.role || t.name || t.urlPattern, {
    message: "A target needs a role, name or urlPattern",
  });

export type ComputerTarget = z.infer<typeof computerTargetSchema>;

/**
 * Snapshot semantic elements: role + accessible name ONLY. Element values
 * have no field to live in — a password can be OBSERVED as a field existing,
 * never STORED as content. `.strict()` rejects any attempt to smuggle more.
 */
export const computerSemanticElementSchema = z
  .object({
    role: z.string().min(1).max(60),
    name: z.string().max(300),
  })
  .strict();

export const computerSemanticSchema = z
  .array(computerSemanticElementSchema)
  .max(COMPUTER_LIMITS.semanticElements);

export type ComputerSemanticElement = z.infer<
  typeof computerSemanticElementSchema
>;
