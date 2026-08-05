/**
 * CSV inspection helpers (pure, unit-tested). Full parsing uses `csv-parse`;
 * these helpers cover what the parser needs to be told: encoding cleanup and
 * the delimiter.
 */

export const IMPORT_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 100,
  maxCellLength: 2_000,
  /** Jobs up to this size run inline in the committing request. */
  inlineRowLimit: 5_000,
} as const;

export const SUPPORTED_DELIMITERS = [";", ",", "\t"] as const;
export type Delimiter = (typeof SUPPORTED_DELIMITERS)[number];

/** Strips a UTF-8 BOM if present. */
export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/** Counts delimiter occurrences outside quoted regions for one line. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

/**
 * Detects the delimiter from a sample: for each candidate, counts per-line
 * occurrences over the first 20 non-empty lines and prefers the candidate with
 * a consistent, non-zero column count (German exports usually use ";").
 * Deterministic tie-break: `;` > `,` > tab.
 */
export function detectDelimiter(sample: string): Delimiter {
  const lines = stripBom(sample)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);
  if (lines.length === 0) return ";";

  let best: Delimiter = ";";
  let bestScore = -1;
  for (const delimiter of SUPPORTED_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.every((c) => c === first);
    const score = (consistent ? 1000 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}
