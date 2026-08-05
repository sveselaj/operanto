import { ActivityOutcome, LeadStatus } from "@operanto/crm-domain";
import { canTransition } from "@operanto/crm-leadstatus";

/**
 * Call-outcome rules (docs/PHASE2_1_DESIGN.md §5) — the server-side follow-up
 * invariant: a non-terminal outcome must carry a valid next-action decision.
 * Pure and unit-tested; enforced inside recordCallOutcome, never left to the
 * consistency checker.
 */

export type NextActionKind = "RETRY" | "CALLBACK" | "APPOINTMENT" | "TASK" | "NONE";

export interface NextActionDecision {
  kind: NextActionKind;
  /** RETRY/CALLBACK due time; must be present for those kinds. */
  at?: Date;
  /** APPOINTMENT times. */
  startAt?: Date;
  endAt?: Date;
  /** TASK details. */
  taskType?: "CALL" | "EMAIL" | "DOCUMENT_REQUEST" | "REVIEW" | "FOLLOW_UP";
  title?: string;
  location?: string;
  createPrepTask?: boolean;
  /** Explicit unscheduled-active justification (CONNECTED/QUALIFIED + NONE). */
  reason?: string;
}

export interface OutcomeRule {
  terminal: boolean;
  requiresReason: boolean;
  /** Next-action kinds the server accepts for this outcome. */
  allowedNextKinds: NextActionKind[];
  /** NONE allowed only with an explicit reason. */
  noneRequiresReason: boolean;
}

export const OUTCOME_RULES: Record<ActivityOutcome, OutcomeRule> = {
  [ActivityOutcome.NO_ANSWER]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["RETRY"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.BUSY]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["RETRY"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.VOICEMAIL]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["RETRY"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.UNAVAILABLE]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["RETRY"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.CALLBACK_REQUESTED]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["CALLBACK"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.APPOINTMENT_BOOKED]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["APPOINTMENT"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.CONNECTED]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["CALLBACK", "TASK", "APPOINTMENT", "NONE"],
    noneRequiresReason: true,
  },
  [ActivityOutcome.QUALIFIED]: {
    terminal: false,
    requiresReason: false,
    allowedNextKinds: ["CALLBACK", "TASK", "APPOINTMENT", "NONE"],
    noneRequiresReason: true,
  },
  [ActivityOutcome.REJECTED]: {
    terminal: true,
    requiresReason: true,
    allowedNextKinds: ["NONE"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.WRONG_NUMBER]: {
    terminal: true,
    requiresReason: true,
    allowedNextKinds: ["NONE"],
    noneRequiresReason: false,
  },
  [ActivityOutcome.DO_NOT_CONTACT]: {
    terminal: true,
    requiresReason: true,
    allowedNextKinds: ["NONE"],
    noneRequiresReason: false,
  },
};

export type OutcomeValidation =
  | { ok: true }
  | {
      ok: false;
      code: "nextActionRequired" | "reasonRequired" | "scheduleRequired" | "invalidInput";
    };

/** Validates the follow-up invariant for one outcome + decision. */
export function validateOutcomeDecision(
  outcome: ActivityOutcome,
  decision: NextActionDecision,
  reason: string | undefined,
  now: Date
): OutcomeValidation {
  const rule = OUTCOME_RULES[outcome];
  if (rule.requiresReason && !reason?.trim()) {
    return { ok: false, code: "reasonRequired" };
  }
  if (!rule.allowedNextKinds.includes(decision.kind)) {
    return { ok: false, code: "nextActionRequired" };
  }
  const future = (d: Date | undefined): d is Date =>
    d instanceof Date && !Number.isNaN(d.getTime()) && d.getTime() > now.getTime() - 60_000;

  switch (decision.kind) {
    case "RETRY":
    case "CALLBACK":
      if (!future(decision.at)) return { ok: false, code: "scheduleRequired" };
      return { ok: true };
    case "APPOINTMENT":
      if (!future(decision.startAt) || !decision.endAt) {
        return { ok: false, code: "scheduleRequired" };
      }
      if (decision.endAt.getTime() <= decision.startAt!.getTime()) {
        return { ok: false, code: "invalidInput" };
      }
      return { ok: true };
    case "TASK":
      if (!decision.taskType || !future(decision.at)) {
        return { ok: false, code: "scheduleRequired" };
      }
      return { ok: true };
    case "NONE":
      if (!rule.terminal && rule.noneRequiresReason && !decision.reason?.trim()) {
        return { ok: false, code: "nextActionRequired" };
      }
      return { ok: true };
  }
}

/** Documented no-answer progression. Statuses outside the ladder keep theirs. */
export function noAnswerProgression(current: LeadStatus): LeadStatus {
  switch (current) {
    case LeadStatus.NEW:
      return LeadStatus.NO_ANSWER_1;
    case LeadStatus.NO_ANSWER_1:
      return LeadStatus.NO_ANSWER_2;
    case LeadStatus.NO_ANSWER_2:
      return LeadStatus.NO_ANSWER_3;
    case LeadStatus.RETRY_LATER:
      return LeadStatus.NO_ANSWER_1;
    default:
      return current; // NO_ANSWER_3 stays; CALLBACK/CONTACTED keep status
  }
}

/** Target status per outcome; null = keep the current status. */
export function outcomeStatusTarget(
  outcome: ActivityOutcome,
  current: LeadStatus
): LeadStatus | null {
  switch (outcome) {
    case ActivityOutcome.NO_ANSWER:
    case ActivityOutcome.BUSY:
    case ActivityOutcome.VOICEMAIL: {
      const next = noAnswerProgression(current);
      return next === current ? null : next;
    }
    case ActivityOutcome.UNAVAILABLE:
      return current === LeadStatus.UNAVAILABLE ? null : LeadStatus.UNAVAILABLE;
    case ActivityOutcome.CONNECTED:
      return current === LeadStatus.CONTACTED ? null : LeadStatus.CONTACTED;
    case ActivityOutcome.CALLBACK_REQUESTED:
      return current === LeadStatus.CALLBACK ? null : LeadStatus.CALLBACK;
    case ActivityOutcome.APPOINTMENT_BOOKED:
      return current === LeadStatus.APPOINTMENT ? null : LeadStatus.APPOINTMENT;
    case ActivityOutcome.QUALIFIED:
      return current === LeadStatus.QUALIFIED ? null : LeadStatus.QUALIFIED;
    case ActivityOutcome.REJECTED:
      return LeadStatus.REJECTED;
    case ActivityOutcome.WRONG_NUMBER:
      return LeadStatus.WRONG_NUMBER;
    case ActivityOutcome.DO_NOT_CONTACT:
      return LeadStatus.DO_NOT_CONTACT;
  }
}

/**
 * Plans the status path to the target, inserting CONTACTED as an intermediate
 * step where the state machine requires it (e.g. NEW → CONTACTED → CALLBACK).
 * Empty array = keep current status (still legal — e.g. NA3 stays NA3).
 */
export function planStatusPath(current: LeadStatus, target: LeadStatus | null): LeadStatus[] {
  if (target === null || target === current) return [];
  if (canTransition(current, target)) return [target];
  if (
    canTransition(current, LeadStatus.CONTACTED) &&
    canTransition(LeadStatus.CONTACTED, target)
  ) {
    return [LeadStatus.CONTACTED, target];
  }
  return [];
}
