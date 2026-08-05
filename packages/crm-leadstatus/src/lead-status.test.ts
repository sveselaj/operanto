import { describe, expect, it } from "vitest";
import { LeadStatus } from "@operanto/crm-domain";
import {
  ACTIVE_STATUSES,
  allowedTransitions,
  canTransition,
  CLOSED_STATUSES,
  isActiveStatus,
  isClosedStatus,
  requiresReason,
  requiresSchedule,
} from "./lead-status";

describe("lead status state machine", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransition(LeadStatus.NEW, LeadStatus.CONTACTED)).toBe(true);
    expect(canTransition(LeadStatus.NEW, LeadStatus.NO_ANSWER_1)).toBe(true);
    expect(canTransition(LeadStatus.NO_ANSWER_1, LeadStatus.NO_ANSWER_2)).toBe(true);
    expect(canTransition(LeadStatus.NO_ANSWER_2, LeadStatus.NO_ANSWER_3)).toBe(true);
    expect(canTransition(LeadStatus.NO_ANSWER_3, LeadStatus.RETRY_LATER)).toBe(true);
    expect(canTransition(LeadStatus.CONTACTED, LeadStatus.CALLBACK)).toBe(true);
    expect(canTransition(LeadStatus.CONTACTED, LeadStatus.APPOINTMENT)).toBe(true);
    expect(canTransition(LeadStatus.CONTACTED, LeadStatus.QUALIFIED)).toBe(true);
    expect(canTransition(LeadStatus.QUALIFIED, LeadStatus.CONVERTED)).toBe(true);
  });

  it("rejects skipping pipeline steps", () => {
    expect(canTransition(LeadStatus.NEW, LeadStatus.CONVERTED)).toBe(false);
    expect(canTransition(LeadStatus.NEW, LeadStatus.QUALIFIED)).toBe(false);
    expect(canTransition(LeadStatus.NO_ANSWER_1, LeadStatus.NO_ANSWER_3)).toBe(false);
    expect(canTransition(LeadStatus.CONTACTED, LeadStatus.CONVERTED)).toBe(false);
  });

  it("allows negative outcomes from every active status", () => {
    for (const from of ACTIVE_STATUSES) {
      for (const to of [
        LeadStatus.REJECTED,
        LeadStatus.LOST,
        LeadStatus.WRONG_NUMBER,
        LeadStatus.DO_NOT_CONTACT,
      ]) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it("closed statuses are terminal", () => {
    for (const from of CLOSED_STATUSES) {
      expect(allowedTransitions(from), from).toEqual([]);
      expect(isClosedStatus(from)).toBe(true);
      expect(isActiveStatus(from)).toBe(false);
    }
  });

  it("wrong number can only re-enter as NEW", () => {
    expect(allowedTransitions(LeadStatus.WRONG_NUMBER)).toEqual([LeadStatus.NEW]);
  });

  it("never allows a self-transition", () => {
    for (const status of Object.values(LeadStatus)) {
      expect(allowedTransitions(status)).not.toContain(status);
    }
  });

  it("requires a reason for rejection-type outcomes only", () => {
    expect(requiresReason(LeadStatus.REJECTED)).toBe(true);
    expect(requiresReason(LeadStatus.LOST)).toBe(true);
    expect(requiresReason(LeadStatus.WRONG_NUMBER)).toBe(true);
    expect(requiresReason(LeadStatus.DO_NOT_CONTACT)).toBe(true);
    expect(requiresReason(LeadStatus.CALLBACK)).toBe(false);
    expect(requiresReason(LeadStatus.CONVERTED)).toBe(false);
  });

  it("requires a schedule for callback and retry", () => {
    expect(requiresSchedule(LeadStatus.CALLBACK)).toBe(true);
    expect(requiresSchedule(LeadStatus.RETRY_LATER)).toBe(true);
    expect(requiresSchedule(LeadStatus.APPOINTMENT)).toBe(false);
    expect(requiresSchedule(LeadStatus.CONTACTED)).toBe(false);
  });

  it("every transition target is a valid status", () => {
    const all = Object.values(LeadStatus);
    for (const from of all) {
      for (const to of allowedTransitions(from)) {
        expect(all).toContain(to);
      }
    }
  });
});
