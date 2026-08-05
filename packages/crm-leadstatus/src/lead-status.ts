import { LeadStatus } from "@operanto/crm-domain";

/**
 * Lead pipeline state machine.
 *
 * Pure module (no DB access) so the transition rules are unit-testable and can
 * later be replaced by organization-configurable rules without touching the
 * enforcement points (lead service + UI).
 */

/** Statuses from which normal sales work continues. */
export const ACTIVE_STATUSES: readonly LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.NO_ANSWER_1,
  LeadStatus.NO_ANSWER_2,
  LeadStatus.NO_ANSWER_3,
  LeadStatus.RETRY_LATER,
  LeadStatus.CALLBACK,
  LeadStatus.APPOINTMENT,
  LeadStatus.QUALIFIED,
  LeadStatus.UNAVAILABLE,
] as const;

/** Terminal statuses: no outgoing transitions. */
export const CLOSED_STATUSES: readonly LeadStatus[] = [
  LeadStatus.CONVERTED,
  LeadStatus.REJECTED,
  LeadStatus.LOST,
  LeadStatus.DO_NOT_CONTACT,
] as const;

/** Negative outcomes reachable from any active status. */
const NEGATIVE_TARGETS: readonly LeadStatus[] = [
  LeadStatus.REJECTED,
  LeadStatus.LOST,
  LeadStatus.WRONG_NUMBER,
  LeadStatus.UNAVAILABLE,
  LeadStatus.DO_NOT_CONTACT,
] as const;

/** Forward transitions of the regular sales flow. */
const FORWARD_TRANSITIONS: Readonly<Partial<Record<LeadStatus, readonly LeadStatus[]>>> = {
  [LeadStatus.NEW]: [LeadStatus.CONTACTED, LeadStatus.NO_ANSWER_1],
  [LeadStatus.CONTACTED]: [
    LeadStatus.CALLBACK,
    LeadStatus.APPOINTMENT,
    LeadStatus.QUALIFIED,
    LeadStatus.RETRY_LATER,
  ],
  [LeadStatus.NO_ANSWER_1]: [LeadStatus.CONTACTED, LeadStatus.NO_ANSWER_2, LeadStatus.CALLBACK],
  [LeadStatus.NO_ANSWER_2]: [LeadStatus.CONTACTED, LeadStatus.NO_ANSWER_3, LeadStatus.CALLBACK],
  [LeadStatus.NO_ANSWER_3]: [LeadStatus.CONTACTED, LeadStatus.RETRY_LATER, LeadStatus.CALLBACK],
  [LeadStatus.RETRY_LATER]: [LeadStatus.CONTACTED, LeadStatus.NO_ANSWER_1, LeadStatus.CALLBACK],
  [LeadStatus.CALLBACK]: [
    LeadStatus.CONTACTED,
    LeadStatus.NO_ANSWER_1,
    LeadStatus.APPOINTMENT,
    LeadStatus.QUALIFIED,
    LeadStatus.RETRY_LATER,
  ],
  [LeadStatus.APPOINTMENT]: [
    LeadStatus.QUALIFIED,
    LeadStatus.CONVERTED,
    LeadStatus.CALLBACK,
    LeadStatus.RETRY_LATER,
  ],
  [LeadStatus.QUALIFIED]: [LeadStatus.CONVERTED, LeadStatus.APPOINTMENT, LeadStatus.CALLBACK],
  [LeadStatus.UNAVAILABLE]: [LeadStatus.CONTACTED, LeadStatus.RETRY_LATER],
  // Corrected phone number re-enters the pipeline.
  [LeadStatus.WRONG_NUMBER]: [LeadStatus.NEW],
};

/** Statuses whose selection requires an explicit reason. */
export const REASON_REQUIRED: readonly LeadStatus[] = [
  LeadStatus.REJECTED,
  LeadStatus.LOST,
  LeadStatus.WRONG_NUMBER,
  LeadStatus.DO_NOT_CONTACT,
] as const;

/** Statuses whose selection requires a scheduled date/time. */
export const SCHEDULE_REQUIRED: readonly LeadStatus[] = [
  LeadStatus.CALLBACK,
  LeadStatus.RETRY_LATER,
] as const;

/** Statuses where a scheduled date/time may optionally be provided. */
export const SCHEDULE_OPTIONAL: readonly LeadStatus[] = [LeadStatus.APPOINTMENT] as const;

export function isActiveStatus(status: LeadStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isClosedStatus(status: LeadStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export function allowedTransitions(from: LeadStatus): LeadStatus[] {
  const forward = FORWARD_TRANSITIONS[from] ?? [];
  const negative = isActiveStatus(from) ? NEGATIVE_TARGETS : [];
  const all = [...forward, ...negative];
  // No self-transitions, no duplicates.
  return [...new Set(all)].filter((s) => s !== from);
}

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export function requiresReason(to: LeadStatus): boolean {
  return REASON_REQUIRED.includes(to);
}

export function requiresSchedule(to: LeadStatus): boolean {
  return SCHEDULE_REQUIRED.includes(to);
}

export function allowsSchedule(to: LeadStatus): boolean {
  return SCHEDULE_REQUIRED.includes(to) || SCHEDULE_OPTIONAL.includes(to);
}
