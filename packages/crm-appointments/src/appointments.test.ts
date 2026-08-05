import { describe, expect, it } from "vitest";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_HORIZON_MS,
  DEFAULT_APPOINTMENT_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  overlapsSlot,
  validateAppointmentTimes,
} from "./appointments";

const now = new Date("2026-08-05T12:00:00Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const HOUR = 3_600_000;

describe("appointment time rules", () => {
  it("accepts a normal future slot", () => {
    expect(validateAppointmentTimes(at(HOUR), at(2 * HOUR), now)).toBe("valid");
  });

  it("rejects end <= start, NaN, and out-of-horizon times", () => {
    expect(validateAppointmentTimes(at(2 * HOUR), at(HOUR), now)).toBe("invalidInput");
    expect(validateAppointmentTimes(at(HOUR), at(HOUR), now)).toBe("invalidInput");
    expect(validateAppointmentTimes(new Date(NaN), at(HOUR), now)).toBe("invalidInput");
    expect(
      validateAppointmentTimes(at(APPOINTMENT_HORIZON_MS + HOUR), at(APPOINTMENT_HORIZON_MS + 2 * HOUR), now)
    ).toBe("invalidInput");
    expect(
      validateAppointmentTimes(at(-APPOINTMENT_HORIZON_MS - 2 * HOUR), at(-APPOINTMENT_HORIZON_MS - HOUR), now)
    ).toBe("invalidInput");
  });

  it("keeps the extracted constants stable", () => {
    expect([...ACTIVE_APPOINTMENT_STATUSES]).toEqual(["SCHEDULED", "CONFIRMED"]);
    expect(DEFAULT_APPOINTMENT_REMINDER_MINUTES).toBe(60);
    expect(MAX_REMINDER_MINUTES).toBe(24 * 60);
  });
});

describe("overlap rule", () => {
  const slot = { startAt: at(HOUR), endAt: at(2 * HOUR) };
  it("detects intersection and ignores mere adjacency", () => {
    expect(overlapsSlot({ startAt: at(1.5 * HOUR), endAt: at(3 * HOUR) }, slot)).toBe(true);
    expect(overlapsSlot({ startAt: at(0), endAt: at(HOUR) }, slot)).toBe(false);
    expect(overlapsSlot({ startAt: at(2 * HOUR), endAt: at(3 * HOUR) }, slot)).toBe(false);
  });
});
