/**
 * Growth normalisation — deterministic keys for import dedupe. Duplicate
 * detection is constraint-backed (unique on organisation + normalized
 * domain) plus review-time candidate matching on normalized names; nothing
 * is ever silently merged.
 */

/** Lower-cased registrable host: strips scheme, path, port and www. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0]!.split("?")[0]!.split("#")[0]!.split(":")[0]!;
  value = value.replace(/^www\./, "");
  if (!value.includes(".") || /\s/.test(value)) return null;
  return value;
}

const LEGAL_FORMS =
  /\b(gmbh & co\.? kg|gmbh|ag|kg|ug|ohg|e\.?k\.?|se|sarl|s\.?r\.?l\.?|sh\.?p\.?k\.?|ltd\.?|llc|inc\.?|bv|oy|ab)\b/g;

/** Lower-cased name with legal forms, punctuation and extra spaces removed. */
export function normalizeCompanyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(LEGAL_FORMS, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    // WHATWG parsing is permissive; require a plausible registrable host.
    if (!normalizeDomain(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
