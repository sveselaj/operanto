import { describe, expect, it } from "vitest";
import {
  ACTION_PROPOSABLE_SESSION_STATUSES,
  COMPUTER_RISK_FLOOR,
  COMPUTER_SESSION_TRANSITIONS,
  VERIFIABLE_ACTION_STATUSES,
  approvalRiskLevelFor,
  canTransitionSession,
  computerApprovalActionType,
  computerSemanticSchema,
  computerTargetSchema,
  initialActionStatusFor,
  isValidConfidence,
  meetsRiskFloor,
  requiresApproval,
} from "@/lib/computer/policy";

describe("computer risk floors", () => {
  it("SUBMIT can never be classified below R3_COMMIT", () => {
    expect(meetsRiskFloor("SUBMIT", "R2_PREPARE")).toBe(false);
    expect(meetsRiskFloor("SUBMIT", "R3_COMMIT")).toBe(true);
    expect(meetsRiskFloor("SUBMIT", "R4_RESTRICTED")).toBe(true);
  });

  it("TYPE/SELECT/UPLOAD floor at R2_PREPARE", () => {
    for (const type of ["TYPE", "SELECT", "UPLOAD"] as const) {
      expect(meetsRiskFloor(type, "R1_NAVIGATE")).toBe(false);
      expect(meetsRiskFloor(type, "R2_PREPARE")).toBe(true);
    }
  });

  it("classification above the floor is always allowed (a commit CLICK is R3)", () => {
    expect(meetsRiskFloor("CLICK", "R3_COMMIT")).toBe(true);
    expect(meetsRiskFloor("OBSERVE", "R4_RESTRICTED")).toBe(true);
  });

  it("every action type has a floor", () => {
    for (const tier of Object.values(COMPUTER_RISK_FLOOR)) {
      expect([
        "R0_OBSERVE",
        "R1_NAVIGATE",
        "R2_PREPARE",
        "R3_COMMIT",
      ]).toContain(tier);
    }
  });
});

describe("risk tier → approval mapping", () => {
  it("maps the C0 ladder onto AIRiskLevel exactly as the ADR documents", () => {
    expect(approvalRiskLevelFor("R0_OBSERVE")).toBe("LOW");
    expect(approvalRiskLevelFor("R1_NAVIGATE")).toBe("LOW");
    expect(approvalRiskLevelFor("R2_PREPARE")).toBe("MEDIUM");
    expect(approvalRiskLevelFor("R3_COMMIT")).toBe("HIGH");
    expect(approvalRiskLevelFor("R4_RESTRICTED")).toBe("BLOCKED");
  });

  it("only R3_COMMIT requires an ApprovalRequest; R4 gets NO approval path", () => {
    expect(requiresApproval("R3_COMMIT")).toBe(true);
    for (const tier of [
      "R0_OBSERVE",
      "R1_NAVIGATE",
      "R2_PREPARE",
      "R4_RESTRICTED",
    ] as const) {
      expect(requiresApproval(tier)).toBe(false);
    }
  });

  it("R4 is born BLOCKED, R3 born APPROVAL_PENDING, the rest PROPOSED", () => {
    expect(initialActionStatusFor("R4_RESTRICTED")).toBe("BLOCKED");
    expect(initialActionStatusFor("R3_COMMIT")).toBe("APPROVAL_PENDING");
    expect(initialActionStatusFor("R0_OBSERVE")).toBe("PROPOSED");
    expect(initialActionStatusFor("R2_PREPARE")).toBe("PROPOSED");
  });

  it("derives dot-namespaced approval action types", () => {
    expect(computerApprovalActionType("SUBMIT")).toBe("computer.submit");
    expect(computerApprovalActionType("UPLOAD")).toBe("computer.upload");
  });
});

describe("session lifecycle", () => {
  it("no state implies execution: ACTIVE/EXECUTING do not exist", () => {
    const states = Object.keys(COMPUTER_SESSION_TRANSITIONS);
    expect(states).not.toContain("ACTIVE");
    expect(states).not.toContain("EXECUTING");
    expect(states).not.toContain("WAITING_APPROVAL");
  });

  it("terminal states allow nothing", () => {
    for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
      expect(COMPUTER_SESSION_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("conclusions are reachable only from READY", () => {
    expect(canTransitionSession("READY", "COMPLETED")).toBe(true);
    expect(canTransitionSession("READY", "FAILED")).toBe(true);
    expect(canTransitionSession("CREATED", "COMPLETED")).toBe(false);
    expect(canTransitionSession("PLANNING", "COMPLETED")).toBe(false);
  });

  it("actions require a planning-or-later session", () => {
    expect(ACTION_PROPOSABLE_SESSION_STATUSES).not.toContain("CREATED");
  });
});

describe("verification eligibility", () => {
  it("never on APPROVAL_PENDING — an unapproved commit must not look executable", () => {
    expect(VERIFIABLE_ACTION_STATUSES).not.toContain("APPROVAL_PENDING");
    expect(VERIFIABLE_ACTION_STATUSES).not.toContain("BLOCKED");
    expect(VERIFIABLE_ACTION_STATUSES).not.toContain("REJECTED");
    expect(VERIFIABLE_ACTION_STATUSES).not.toContain("CANCELLED");
  });
});

describe("confidence", () => {
  it("accepts only the documented 0..1 range", () => {
    expect(isValidConfidence(0)).toBe(true);
    expect(isValidConfidence(0.99)).toBe(true);
    expect(isValidConfidence(1)).toBe(true);
    expect(isValidConfidence(-0.01)).toBe(false);
    expect(isValidConfidence(1.01)).toBe(false);
    expect(isValidConfidence(Number.NaN)).toBe(false);
  });
});

describe("strict content schemas (secret-persistence safeguard)", () => {
  it("targets are semantic role/name addressing — unknown keys are rejected", () => {
    expect(
      computerTargetSchema.safeParse({
        kind: "semantic",
        role: "button",
        name: "Orders",
      }).success,
    ).toBe(true);
    // No coordinates-as-primary, no values, no cookie/token smuggling.
    for (const hostile of [
      { kind: "semantic", role: "button", name: "x", value: "hunter2" },
      { kind: "semantic", role: "textbox", name: "x", password: "hunter2" },
      { kind: "semantic", x: 620, y: 940 },
      { kind: "coordinates", role: "button" },
    ]) {
      expect(computerTargetSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("a target must actually address something", () => {
    expect(computerTargetSchema.safeParse({ kind: "semantic" }).success).toBe(false);
  });

  it("snapshot elements store role + accessible name ONLY — values have no field", () => {
    expect(
      computerSemanticSchema.safeParse([{ role: "button", name: "I've sent the funds" }])
        .success,
    ).toBe(true);
    expect(
      computerSemanticSchema.safeParse([
        { role: "textbox", name: "Password", value: "hunter2" },
      ]).success,
    ).toBe(false);
    expect(
      computerSemanticSchema.safeParse([
        { role: "textbox", name: "TOTP", sessionToken: "abc" },
      ]).success,
    ).toBe(false);
  });
});
