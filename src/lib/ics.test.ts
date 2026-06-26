import { describe, it, expect } from "vitest";
import { buildICS } from "./ics";

const start = new Date("2026-06-25T10:00:00.000Z");
const now = new Date("2026-06-20T08:30:00.000Z");

describe("buildICS", () => {
  it("produces a valid single-event VCALENDAR", () => {
    const ics = buildICS(
      { uid: "appt_1@operanto", title: "Survey", start, durationMinutes: 30, location: "On-site" },
      now,
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:appt_1@operanto");
    expect(ics).toContain("SUMMARY:Survey");
    expect(ics).toContain("LOCATION:On-site");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("\r\n"); // CRLF line endings
  });

  it("formats UTC timestamps and computes the end from duration", () => {
    const ics = buildICS({ uid: "x", title: "T", start, durationMinutes: 30 }, now);
    expect(ics).toContain("DTSTART:20260625T100000Z");
    expect(ics).toContain("DTEND:20260625T103000Z");
    expect(ics).toContain("DTSTAMP:20260620T083000Z");
  });

  it("defaults to a 60-minute event when no duration is given", () => {
    const ics = buildICS({ uid: "x", title: "T", start }, now);
    expect(ics).toContain("DTEND:20260625T110000Z");
  });

  it("escapes commas and semicolons in text", () => {
    const ics = buildICS({ uid: "x", title: "Install, measure; fit", start }, now);
    expect(ics).toContain("SUMMARY:Install\\, measure\\; fit");
  });

  it("omits optional location/description lines when absent", () => {
    const ics = buildICS({ uid: "x", title: "T", start }, now);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });
});
