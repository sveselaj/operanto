import type { GrowthAccountStatus } from "@prisma/client";

/**
 * Growth account lifecycle — a pure, explicit transition machine. Every
 * status change in the domain goes through assertTransition; there is no
 * free-form status write anywhere. SUPPRESSED is terminal inside the
 * machine: leaving it is an explicit privacy-gated operation
 * (unsuppressGrowthAccount), never an ordinary transition. CUSTOMER is
 * terminal — the account has converted and lives on through its linked
 * Customer record.
 */

const TRANSITIONS: Record<GrowthAccountStatus, GrowthAccountStatus[]> = {
  IMPORTED: ["NEEDS_REVIEW", "READY_FOR_RESEARCH", "SUPPRESSED"],
  NEEDS_REVIEW: ["READY_FOR_RESEARCH", "REJECTED", "SUPPRESSED"],
  READY_FOR_RESEARCH: ["RESEARCHING", "SUPPRESSED"],
  RESEARCHING: ["READY_FOR_ASSESSMENT", "READY_FOR_RESEARCH", "SUPPRESSED"],
  READY_FOR_ASSESSMENT: [
    "APPROVED",
    "REJECTED",
    "READY_FOR_RESEARCH",
    "SUPPRESSED",
  ],
  APPROVED: ["DRAFT_PREPARED", "NOT_NOW", "SUPPRESSED"],
  DRAFT_PREPARED: ["CONTACTED", "APPROVED", "SUPPRESSED"],
  CONTACTED: ["REPLIED", "NOT_NOW", "SUPPRESSED"],
  REPLIED: ["QUALIFIED", "NOT_NOW", "SUPPRESSED"],
  QUALIFIED: ["MEETING_BOOKED", "NOT_NOW", "SUPPRESSED"],
  MEETING_BOOKED: ["CUSTOMER", "NOT_NOW", "SUPPRESSED"],
  NOT_NOW: ["READY_FOR_ASSESSMENT", "SUPPRESSED"],
  REJECTED: ["READY_FOR_RESEARCH", "SUPPRESSED"],
  SUPPRESSED: [],
  CUSTOMER: [],
};

export function canTransition(
  from: GrowthAccountStatus,
  to: GrowthAccountStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: GrowthAccountStatus, to: GrowthAccountStatus) {
    super(`Invalid account transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(
  from: GrowthAccountStatus,
  to: GrowthAccountStatus,
): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Draft lifecycle — same discipline, smaller machine. No sending states
 *  exist in Release 1: MANUALLY_SENT records a human act, nothing more. */
const DRAFT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["AWAITING_REVIEW", "CANCELLED"],
  AWAITING_REVIEW: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED"],
  APPROVED: ["MANUALLY_SENT", "CANCELLED"],
  REJECTED: ["DRAFT", "CANCELLED"],
  MANUALLY_SENT: [],
  CANCELLED: [],
};

export function canTransitionDraft(from: string, to: string): boolean {
  return DRAFT_TRANSITIONS[from]?.includes(to) ?? false;
}
