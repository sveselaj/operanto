import { describe, expect, it } from "vitest";
import { ActivityOutcome, LeadStatus } from "@operanto/crm-domain";
import {
  noAnswerProgression,
  outcomeStatusTarget,
  planStatusPath,
  validateOutcomeDecision,
} from "./call-outcome";
import { parsePhoneDetails } from "@operanto/crm-phone";

const NOW = new Date("2026-08-04T12:00:00Z");
const FUTURE = new Date("2026-08-05T10:00:00Z");

describe("parsePhoneDetails — German formats", () => {
  it.each([
    ["0171 1234567", "+491711234567"],
    ["01711234567", "+491711234567"],
    ["0049 171 1234567", "+491711234567"],
    ["+49 171 1234567", "+491711234567"],
    ["49 171 1234567", "+491711234567"],
    ["+49 (0)171 1234567", "+491711234567"],
    ["0171/123-45-67", "+491711234567"],
    ["030 1234567", "+49301234567"],
  ])("%s → %s", (raw, expected) => {
    const details = parsePhoneDetails(raw);
    expect(details.normalized).toBe(expected);
    expect(details.status === "VALID" || details.status === "POSSIBLE").toBe(true);
    expect(details.countryCode).toBe("49");
  });

  it("never duplicates the 49 prefix", () => {
    expect(parsePhoneDetails("+49 171 1234567").normalized).toBe("+491711234567");
    expect(parsePhoneDetails("0049171 1234567").normalized).toBe("+491711234567");
    expect(parsePhoneDetails("491711234567").normalized).toBe("+491711234567");
  });

  it("flags invalid and missing distinctly — never invents numbers", () => {
    expect(parsePhoneDetails("123").status).toBe("INVALID");
    expect(parsePhoneDetails("keine nummer").status).toBe("INVALID");
    expect(parsePhoneDetails("").status).toBe("MISSING");
    expect(parsePhoneDetails(null).status).toBe("MISSING");
    expect(parsePhoneDetails("123").normalized).toBeNull();
  });

  it("exposes national number components", () => {
    const details = parsePhoneDetails("0171 1234567");
    expect(details.nationalNumber).toBe("1711234567");
  });
});

describe("no-answer progression", () => {
  it("advances NEW → NA1 → NA2 → NA3 and stops", () => {
    expect(noAnswerProgression(LeadStatus.NEW)).toBe(LeadStatus.NO_ANSWER_1);
    expect(noAnswerProgression(LeadStatus.NO_ANSWER_1)).toBe(LeadStatus.NO_ANSWER_2);
    expect(noAnswerProgression(LeadStatus.NO_ANSWER_2)).toBe(LeadStatus.NO_ANSWER_3);
    expect(noAnswerProgression(LeadStatus.NO_ANSWER_3)).toBe(LeadStatus.NO_ANSWER_3);
  });
  it("keeps CALLBACK/CONTACTED status on a missed call", () => {
    expect(noAnswerProgression(LeadStatus.CALLBACK)).toBe(LeadStatus.CALLBACK);
    expect(noAnswerProgression(LeadStatus.CONTACTED)).toBe(LeadStatus.CONTACTED);
  });
});

describe("outcome → status mapping", () => {
  it("maps outcomes to their target statuses", () => {
    expect(outcomeStatusTarget(ActivityOutcome.CONNECTED, LeadStatus.NEW)).toBe(
      LeadStatus.CONTACTED
    );
    expect(outcomeStatusTarget(ActivityOutcome.CALLBACK_REQUESTED, LeadStatus.NEW)).toBe(
      LeadStatus.CALLBACK
    );
    expect(outcomeStatusTarget(ActivityOutcome.DO_NOT_CONTACT, LeadStatus.CONTACTED)).toBe(
      LeadStatus.DO_NOT_CONTACT
    );
    expect(outcomeStatusTarget(ActivityOutcome.NO_ANSWER, LeadStatus.NO_ANSWER_3)).toBeNull();
  });

  it("plans two-step paths through CONTACTED where the machine requires it", () => {
    expect(planStatusPath(LeadStatus.NEW, LeadStatus.CALLBACK)).toEqual([
      LeadStatus.CONTACTED,
      LeadStatus.CALLBACK,
    ]);
    expect(planStatusPath(LeadStatus.CONTACTED, LeadStatus.CALLBACK)).toEqual([
      LeadStatus.CALLBACK,
    ]);
    expect(planStatusPath(LeadStatus.NEW, LeadStatus.QUALIFIED)).toEqual([
      LeadStatus.CONTACTED,
      LeadStatus.QUALIFIED,
    ]);
    expect(planStatusPath(LeadStatus.CONTACTED, null)).toEqual([]);
  });
});

describe("follow-up invariant", () => {
  it("no-answer requires a retry schedule", () => {
    expect(
      validateOutcomeDecision(ActivityOutcome.NO_ANSWER, { kind: "NONE" }, undefined, NOW)
    ).toMatchObject({ ok: false, code: "nextActionRequired" });
    expect(
      validateOutcomeDecision(ActivityOutcome.NO_ANSWER, { kind: "RETRY" }, undefined, NOW)
    ).toMatchObject({ ok: false, code: "scheduleRequired" });
    expect(
      validateOutcomeDecision(
        ActivityOutcome.NO_ANSWER,
        { kind: "RETRY", at: FUTURE },
        undefined,
        NOW
      )
    ).toEqual({ ok: true });
  });

  it("callback requested requires the callback time", () => {
    expect(
      validateOutcomeDecision(ActivityOutcome.CALLBACK_REQUESTED, { kind: "CALLBACK" }, undefined, NOW)
    ).toMatchObject({ ok: false, code: "scheduleRequired" });
    expect(
      validateOutcomeDecision(
        ActivityOutcome.CALLBACK_REQUESTED,
        { kind: "CALLBACK", at: FUTURE },
        undefined,
        NOW
      )
    ).toEqual({ ok: true });
  });

  it("appointment booked requires start and end", () => {
    expect(
      validateOutcomeDecision(
        ActivityOutcome.APPOINTMENT_BOOKED,
        { kind: "APPOINTMENT", startAt: FUTURE },
        undefined,
        NOW
      )
    ).toMatchObject({ ok: false, code: "scheduleRequired" });
    expect(
      validateOutcomeDecision(
        ActivityOutcome.APPOINTMENT_BOOKED,
        {
          kind: "APPOINTMENT",
          startAt: FUTURE,
          endAt: new Date(FUTURE.getTime() + 3_600_000),
        },
        undefined,
        NOW
      )
    ).toEqual({ ok: true });
  });

  it("connected/qualified need a follow-up or an explicit reason", () => {
    expect(
      validateOutcomeDecision(ActivityOutcome.CONNECTED, { kind: "NONE" }, undefined, NOW)
    ).toMatchObject({ ok: false, code: "nextActionRequired" });
    expect(
      validateOutcomeDecision(
        ActivityOutcome.CONNECTED,
        { kind: "NONE", reason: "Kunde meldet sich selbst" },
        undefined,
        NOW
      )
    ).toEqual({ ok: true });
    expect(
      validateOutcomeDecision(
        ActivityOutcome.QUALIFIED,
        { kind: "TASK", taskType: "REVIEW", at: FUTURE },
        undefined,
        NOW
      )
    ).toEqual({ ok: true });
  });

  it("terminal outcomes require a reason and forbid next actions", () => {
    expect(
      validateOutcomeDecision(ActivityOutcome.REJECTED, { kind: "NONE" }, undefined, NOW)
    ).toMatchObject({ ok: false, code: "reasonRequired" });
    expect(
      validateOutcomeDecision(ActivityOutcome.REJECTED, { kind: "NONE" }, "kein Bedarf", NOW)
    ).toEqual({ ok: true });
    expect(
      validateOutcomeDecision(
        ActivityOutcome.DO_NOT_CONTACT,
        { kind: "CALLBACK", at: FUTURE },
        "Widerspruch",
        NOW
      )
    ).toMatchObject({ ok: false, code: "nextActionRequired" });
  });
});
