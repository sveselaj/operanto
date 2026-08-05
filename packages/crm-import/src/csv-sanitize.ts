/**
 * CSV output sanitization (pure, unit-tested).
 *
 * Formula-injection policy (docs/PHASE3_DESIGN.md §6): imported cell values are
 * STORED verbatim; every CSV the application GENERATES neutralizes cells that
 * a spreadsheet would execute by prefixing a single quote (OWASP guidance).
 * The web UI renders text only, so stored values stay untouched.
 */

const DANGEROUS_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function sanitizeCsvCell(value: string): string {
  if (value.length > 0 && DANGEROUS_PREFIXES.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvCell(value: string, delimiter: string): string {
  if (
    value.includes('"') ||
    value.includes(delimiter) ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds a sanitized CSV string (used for the import error report). */
export function buildCsv(rows: string[][], delimiter = ";"): string {
  return rows
    .map((row) =>
      row.map((cell) => escapeCsvCell(sanitizeCsvCell(cell), delimiter)).join(delimiter)
    )
    .join("\r\n");
}
