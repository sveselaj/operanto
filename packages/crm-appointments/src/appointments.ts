import { AppointmentStatus } from "@operanto/crm-domain";

/**
 * Appointment (scheduling) rules — the platform's ONE appointment engine
 * (OI-2; extracted from the Phase 2 appointment service, behavior unchanged).
 * The Prisma-bound lifecycle service stays in the application; these are the
 * provider-independent rules it enforces.
 */

/** Statuses that occupy calendar time and drive derived lead fields. */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/** Obvious-garbage guard: appointments must lie within ±2 years. */
export const APPOINTMENT_HORIZON_MS = 2 * 365 * 86_400_000;

/** Appointment upcoming-reminder default (sweep), in minutes. */
export const DEFAULT_APPOINTMENT_REMINDER_MINUTES = 60;

/** Reminder windows are capped at 24 h — the sweep's scan horizon. */
export const MAX_REMINDER_MINUTES = 24 * 60;

export type AppointmentTimesVerdict = "valid" | "invalidInput";

/**
 * Time validation: parseable, end strictly after start, inside the horizon.
 * Returns a verdict instead of throwing so callers map it onto their own
 * error channel (the app service throws its i18n-coded ServiceError).
 */
export function validateAppointmentTimes(
  startAt: Date,
  endAt: Date,
  now: Date
): AppointmentTimesVerdict {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return "invalidInput";
  }
  if (endAt.getTime() <= startAt.getTime()) return "invalidInput";
  if (startAt.getTime() > now.getTime() + APPOINTMENT_HORIZON_MS) return "invalidInput";
  if (endAt.getTime() < now.getTime() - APPOINTMENT_HORIZON_MS) return "invalidInput";
  return "valid";
}

/**
 * Overlap rule (half-open interval intersection). The owner-conflict check is
 * a WARNING, never a rejection — double-booking is a human decision.
 */
export function overlapsSlot(
  a: { startAt: Date; endAt: Date },
  b: { startAt: Date; endAt: Date }
): boolean {
  return a.startAt.getTime() < b.endAt.getTime() && a.endAt.getTime() > b.startAt.getTime();
}
