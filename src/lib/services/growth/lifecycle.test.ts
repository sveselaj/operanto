import { describe, expect, it } from "vitest";
import type { GrowthAccountStatus } from "@prisma/client";
import {
  assertTransition,
  canTransition,
  canTransitionDraft,
} from "@/lib/services/growth/lifecycle";

describe("growth account lifecycle", () => {
  it("follows the happy path from import to customer", () => {
    const path: GrowthAccountStatus[] = [
      "IMPORTED",
      "READY_FOR_RESEARCH",
      "RESEARCHING",
      "READY_FOR_ASSESSMENT",
      "APPROVED",
      "DRAFT_PREPARED",
      "CONTACTED",
      "REPLIED",
      "QUALIFIED",
      "MEETING_BOOKED",
      "CUSTOMER",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("rejects skips, regressions and exits from terminal states", () => {
    expect(canTransition("IMPORTED", "APPROVED")).toBe(false);
    expect(canTransition("IMPORTED", "CONTACTED")).toBe(false);
    expect(canTransition("CONTACTED", "IMPORTED")).toBe(false);
    expect(canTransition("CUSTOMER", "NOT_NOW")).toBe(false);
    expect(canTransition("SUPPRESSED", "NEEDS_REVIEW")).toBe(false);
    expect(canTransition("SUPPRESSED", "READY_FOR_RESEARCH")).toBe(false);
    expect(() => assertTransition("IMPORTED", "CUSTOMER")).toThrow(
      /Invalid account transition/,
    );
  });

  it("every non-terminal state can reach SUPPRESSED", () => {
    const states: GrowthAccountStatus[] = [
      "IMPORTED",
      "NEEDS_REVIEW",
      "READY_FOR_RESEARCH",
      "RESEARCHING",
      "READY_FOR_ASSESSMENT",
      "APPROVED",
      "DRAFT_PREPARED",
      "CONTACTED",
      "REPLIED",
      "QUALIFIED",
      "MEETING_BOOKED",
      "NOT_NOW",
      "REJECTED",
    ];
    for (const state of states) {
      expect(canTransition(state, "SUPPRESSED")).toBe(true);
    }
  });

  it("re-assessment and re-research loops exist without shortcuts", () => {
    expect(canTransition("NOT_NOW", "READY_FOR_ASSESSMENT")).toBe(true);
    expect(canTransition("REJECTED", "READY_FOR_RESEARCH")).toBe(true);
    expect(canTransition("READY_FOR_ASSESSMENT", "READY_FOR_RESEARCH")).toBe(true);
    expect(canTransition("NOT_NOW", "APPROVED")).toBe(false);
  });
});

describe("growth draft lifecycle (Release 1 — no sending states)", () => {
  it("draft → review → approved → manually sent, and nothing beyond", () => {
    expect(canTransitionDraft("DRAFT", "AWAITING_REVIEW")).toBe(true);
    expect(canTransitionDraft("AWAITING_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionDraft("APPROVED", "MANUALLY_SENT")).toBe(true);
    expect(canTransitionDraft("MANUALLY_SENT", "APPROVED")).toBe(false);
    expect(canTransitionDraft("DRAFT", "MANUALLY_SENT")).toBe(false);
    expect(canTransitionDraft("REJECTED", "MANUALLY_SENT")).toBe(false);
  });
});
