import { UserRole, UserStatus } from "@operanto/crm-domain";

/**
 * Pure round-robin member selection (docs/PHASE3_DESIGN.md §12).
 * Equal weight, stable ordering (createdAt, id), rotation starts after the
 * pool's lastAssignedUserId, ineligible members are skipped. Deterministic and
 * unit-tested; the transactional executor lives in assignment-core.
 */

export interface RoundRobinCandidate {
  id: string;
  userId: string;
  isActive: boolean;
  capacityOverride: number | null;
  createdAt: Date;
  user: {
    status: UserStatus;
    role: UserRole;
    autoAssignEnabled: boolean;
    maxActiveLeads: number | null;
    teamId: string | null;
  };
  /** Active leads currently assigned to the member. */
  activeLeadCount: number;
}

export type IneligibleReason =
  | "inactive_member"
  | "inactive_user"
  | "role"
  | "auto_assign_disabled"
  | "team_mismatch"
  | "capacity_reached";

export function memberEligibility(
  member: RoundRobinCandidate,
  poolTeamId: string | null
): IneligibleReason | null {
  if (!member.isActive) return "inactive_member";
  if (member.user.status !== UserStatus.ACTIVE) return "inactive_user";
  if (member.user.role === UserRole.AUDITOR) return "role";
  if (!member.user.autoAssignEnabled) return "auto_assign_disabled";
  if (poolTeamId && member.user.teamId !== poolTeamId) return "team_mismatch";
  const cap = member.capacityOverride ?? member.user.maxActiveLeads;
  if (cap !== null && cap !== undefined && member.activeLeadCount >= cap) {
    return "capacity_reached";
  }
  return null;
}

/** Stable order: join date, then id — never affected by name or workload. */
export function orderMembers(members: RoundRobinCandidate[]): RoundRobinCandidate[] {
  return [...members].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Picks the next eligible member after `lastAssignedUserId` (wrap-around).
 * Returns null when no member is eligible — the caller leaves the record
 * unassigned and reports the failure.
 */
export function pickNextMember(
  members: RoundRobinCandidate[],
  lastAssignedUserId: string | null,
  poolTeamId: string | null
): RoundRobinCandidate | null {
  const ordered = orderMembers(members);
  if (ordered.length === 0) return null;
  const lastIndex = ordered.findIndex((m) => m.userId === lastAssignedUserId);
  for (let offset = 1; offset <= ordered.length; offset++) {
    const candidate = ordered[(lastIndex + offset) % ordered.length];
    if (memberEligibility(candidate, poolTeamId) === null) return candidate;
  }
  return null;
}
