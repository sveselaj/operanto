import { describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@operanto/crm-domain";
import {
  memberEligibility,
  orderMembers,
  pickNextMember,
  type RoundRobinCandidate,
} from "./round-robin";

let seq = 0;
function member(overrides: Partial<RoundRobinCandidate> & { userId: string }): RoundRobinCandidate {
  seq += 1;
  return {
    id: `m${String(seq).padStart(3, "0")}`,
    isActive: true,
    capacityOverride: null,
    createdAt: new Date(2026, 0, seq),
    user: {
      status: UserStatus.ACTIVE,
      role: UserRole.AGENT,
      autoAssignEnabled: true,
      maxActiveLeads: null,
      teamId: null,
    },
    activeLeadCount: 0,
    ...overrides,
  };
}

describe("round-robin selection", () => {
  it("rotates in stable order and wraps around", () => {
    const members = [member({ userId: "a" }), member({ userId: "b" }), member({ userId: "c" })];
    expect(pickNextMember(members, null, null)?.userId).toBe("a");
    expect(pickNextMember(members, "a", null)?.userId).toBe("b");
    expect(pickNextMember(members, "b", null)?.userId).toBe("c");
    expect(pickNextMember(members, "c", null)?.userId).toBe("a");
  });

  it("ordering is independent of input order", () => {
    const a = member({ userId: "a" });
    const b = member({ userId: "b" });
    expect(orderMembers([b, a]).map((m) => m.userId)).toEqual(
      orderMembers([a, b]).map((m) => m.userId)
    );
  });

  it("skips ineligible members for every documented reason", () => {
    expect(memberEligibility(member({ userId: "x", isActive: false }), null)).toBe(
      "inactive_member"
    );
    expect(
      memberEligibility(
        member({ userId: "x", user: { ...member({ userId: "y" }).user, status: UserStatus.INACTIVE } }),
        null
      )
    ).toBe("inactive_user");
    expect(
      memberEligibility(
        member({ userId: "x", user: { ...member({ userId: "y" }).user, role: UserRole.AUDITOR } }),
        null
      )
    ).toBe("role");
    expect(
      memberEligibility(
        member({
          userId: "x",
          user: { ...member({ userId: "y" }).user, autoAssignEnabled: false },
        }),
        null
      )
    ).toBe("auto_assign_disabled");
    expect(
      memberEligibility(
        member({ userId: "x", user: { ...member({ userId: "y" }).user, teamId: "team-b" } }),
        "team-a"
      )
    ).toBe("team_mismatch");
  });

  it("capacity: member override wins over user default; at-cap members are skipped", () => {
    const atUserCap = member({
      userId: "a",
      activeLeadCount: 5,
      user: { ...member({ userId: "x" }).user, maxActiveLeads: 5 },
    });
    expect(memberEligibility(atUserCap, null)).toBe("capacity_reached");

    const overrideRaisesCap = member({
      userId: "b",
      activeLeadCount: 5,
      capacityOverride: 10,
      user: { ...member({ userId: "x" }).user, maxActiveLeads: 5 },
    });
    expect(memberEligibility(overrideRaisesCap, null)).toBeNull();

    const unlimited = member({ userId: "c", activeLeadCount: 1000 });
    expect(memberEligibility(unlimited, null)).toBeNull();
  });

  it("skips at-capacity members during rotation and returns null when nobody fits", () => {
    const full = member({
      userId: "full",
      activeLeadCount: 3,
      capacityOverride: 3,
    });
    const free = member({ userId: "free" });
    expect(pickNextMember([full, free], null, null)?.userId).toBe("free");
    expect(pickNextMember([full], null, null)).toBeNull();
    expect(pickNextMember([], null, null)).toBeNull();
  });
});
