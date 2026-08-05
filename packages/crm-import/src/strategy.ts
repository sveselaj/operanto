import { ImportStrategy } from "@operanto/crm-domain";
import type { DuplicateResult } from "@operanto/crm-deduplication";

/**
 * Import-strategy dispositions (pure, unit-tested; docs/PHASE3_DESIGN.md §8).
 * REVIEW rows are never auto-processed — they wait in the review queue.
 * There is intentionally no "overwrite everything" disposition: even the
 * EXPLICIT_OVERWRITE strategy routes matches into row-by-row review.
 */

export type RowDisposition = "CREATE" | "SKIP" | "REVIEW" | "FILL";

export function dispositionFor(
  strategy: ImportStrategy,
  duplicate: DuplicateResult["kind"]
): RowDisposition {
  if (duplicate === "UNIQUE") return "CREATE";
  if (duplicate === "FILE_DUPLICATE") return "SKIP";
  if (duplicate === "CONFLICT") {
    // Critical rule: conflicting exact identifiers always need a human.
    return strategy === ImportStrategy.CREATE_NEW_ONLY ? "SKIP" : "REVIEW";
  }
  switch (strategy) {
    case ImportStrategy.CREATE_NEW_ONLY:
      return "SKIP";
    case ImportStrategy.SKIP_DUPLICATES:
      return duplicate === "EXACT" ? "SKIP" : "REVIEW";
    case ImportStrategy.FILL_EMPTY_FIELDS:
      return duplicate === "EXACT" ? "FILL" : "REVIEW";
    case ImportStrategy.REVIEW_ALL_MATCHES:
    case ImportStrategy.EXPLICIT_OVERWRITE:
      return "REVIEW";
  }
}

/**
 * Lead fields import may write. Fill-empty touches these ONLY when currently
 * empty; explicit overwrite may replace them after per-field review. Everything
 * else (status, consent, doNotCall, assignment, lifecycle timestamps, history)
 * is protected — see PROTECTED_LEAD_FIELDS.
 */
export const IMPORT_WRITABLE_FIELDS = [
  "firstName",
  "lastName",
  "companyName",
  "phone",
  "normalizedPhone",
  "secondaryPhone",
  "email",
  "normalizedEmail",
  "source",
  "category",
  "platform",
  "estimatedValue",
  "currency",
  "dataOrigin",
  "externalReference",
] as const;

export type ImportWritableField = (typeof IMPORT_WRITABLE_FIELDS)[number];

/** Documented protected set — never writable by import on existing leads. */
export const PROTECTED_LEAD_FIELDS = [
  "organizationId",
  "status",
  "convertedAt",
  "lostAt",
  "archivedAt",
  "consentStatus",
  "doNotCall",
  "assignedUserId",
  "assignedTeamId",
  "fullName", // derived from first/last on update paths, not overwritten blindly
] as const;

export function isImportWritableField(field: string): field is ImportWritableField {
  return (IMPORT_WRITABLE_FIELDS as readonly string[]).includes(field);
}
