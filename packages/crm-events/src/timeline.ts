import { z } from "zod";

/**
 * Unified timeline contract (OI-2). One chronological stream per customer /
 * lead across modules; every module maps its rows into this shape at the read
 * edge. Pure contract + mapping helpers — no storage of its own (the Activity
 * table remains the domain timeline's persistence; other kinds are merged in
 * at read time).
 */

export const TIMELINE_KINDS = [
  "conversation",
  "call",
  "activity",
  "task",
  "appointment",
  "callback",
  "import",
  "lead_status_change",
  "assistant_action",
  "approval",
  "audit_summary",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const timelineItem = z.object({
  /** `<kind>:<source row id>` — stable and unique within a stream. */
  id: z.string(),
  kind: z.enum(TIMELINE_KINDS),
  occurredAt: z.date(),
  /**
   * Machine-readable type within the kind (e.g. activity type string, task
   * type, audit action). UI concerns (labels, icons, colors) are derived by
   * the presentation layer from this — never stored here.
   */
  type: z.string(),
  /** Ids only — resolution to display data happens at the read edge. */
  refs: z.object({
    organisationId: z.string(),
    customerId: z.string().nullable(),
    leadId: z.string().nullable(),
    conversationId: z.string().nullable(),
    actorId: z.string().nullable(),
    entityId: z.string(),
  }),
  /** Small, non-PII fact bag (counts, statuses, outcome codes). */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type TimelineItem = z.infer<typeof timelineItem>;

export function timelineItemId(kind: TimelineKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

/** Merge pre-mapped streams into one chronological stream (newest first). */
export function mergeTimeline(...streams: TimelineItem[][]): TimelineItem[] {
  return streams
    .flat()
    .sort(
      (a, b) =>
        b.occurredAt.getTime() - a.occurredAt.getTime() || a.id.localeCompare(b.id)
    );
}
