/**
 * iCalendar (.ics) generation (pure). The zero-integration calendar fallback —
 * any appointment can be downloaded and imported into Google/Outlook/Apple
 * Calendar without OAuth. (Two-way sync is handled by the Integration Hub.)
 */

export type IcsEvent = {
  uid: string;
  title: string;
  start: Date;
  durationMinutes?: number | null;
  location?: string | null;
  description?: string | null;
};

function fmt(d: Date): string {
  // UTC basic format: 20260625T100000Z
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(s: string): string {
  return s.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

/** Build a single-event VCALENDAR string. `now` is injectable for tests. */
export function buildICS(ev: IcsEvent, now: Date = new Date()): string {
  const end = new Date(ev.start.getTime() + (ev.durationMinutes ?? 60) * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Operanto//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${fmt(now)}`,
    `DTSTART:${fmt(ev.start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escapeText(ev.title)}`,
    ev.location ? `LOCATION:${escapeText(ev.location)}` : null,
    ev.description ? `DESCRIPTION:${escapeText(ev.description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean) as string[];
  return lines.join("\r\n");
}
