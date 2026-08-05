// The package's convenience wrappers bind their metadata via a CJS JSON
// require that tsx's loader mangles (JSON arrives as {default: …}). Using the
// core function with explicitly imported metadata works identically under
// Next.js, Vitest and tsx CLIs.
import { parsePhoneNumberFromString as parseWithMetadata } from "libphonenumber-js/core";
import type { CountryCode, MetadataJson } from "libphonenumber-js/core";
// Bare .json specifier without an import attribute: esbuild (tsx) and Vite
// load the JSON directly; Turbopack rewrites it to the package's ESM wrapper.
// A `with { type: "json" }` attribute would break the Turbopack rewrite, and
// the wrapper path itself is blocked by the package's exports map under Node.
import metadataJson from "libphonenumber-js/metadata.min.json";

const METADATA = metadataJson as unknown as MetadataJson;

/**
 * Normalization helpers for lead contact data. Used on every write path
 * (manual entry, import, API) so that duplicate detection can rely on
 * `normalizedPhone` / `normalizedEmail` equality.
 */

const DEFAULT_REGION: CountryCode = "DE";

/**
 * Duplicate-49 guard (docs/PHASE2_1_DESIGN.md §1): bare digits starting with
 * "49" (no +/00/leading 0) are ambiguous — they could be the real area code
 * 04917 (Norderney) written without its trunk zero, or a country code written
 * without "+". Documented tie-break: when reading the "49" as the country code
 * yields a VALID number, that interpretation wins — an existing 49 prefix is
 * never duplicated. Otherwise the national parse stands.
 */
function parseSmart(trimmed: string, region: CountryCode) {
  const parsed = parseWithMetadata(trimmed, { defaultCountry: region }, METADATA);
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (
    region === "DE" &&
    !digits.startsWith("+") &&
    !digits.startsWith("0") &&
    digits.startsWith("49")
  ) {
    const alt = parseWithMetadata(`+${digits}`, { defaultCountry: region }, METADATA);
    if (alt?.isValid()) return alt;
    if (!parsed?.isValid() && alt?.isPossible()) return alt;
  }
  return parsed;
}

/**
 * Normalizes a phone number to E.164 via libphonenumber-js (Phase 3 upgrade,
 * docs/PHASE3_DESIGN.md §6). The organization default region (DE) resolves
 * national numbers ("030…" → "+4930…"); "0049…" and "+49…" are equivalent.
 *
 * Returns null when the input is not a length-plausible phone number — the
 * caller distinguishes invalid from missing. No number is ever fabricated:
 * bare digits without "+"/"00"/trunk-"0" that don't form a plausible national
 * number yield null instead of a guess.
 */
export function normalizePhone(
  raw: string | null | undefined,
  region: CountryCode = DEFAULT_REGION
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parseSmart(trimmed, region);
  if (!parsed || !parsed.isPossible()) return null;
  return parsed.number;
}

export type PhoneVerdict = "MISSING" | "VALID" | "POSSIBLE" | "INVALID";

export interface PhoneDetails {
  /** E.164 when VALID/POSSIBLE, else null. Never guessed from uncertain input. */
  normalized: string | null;
  countryCode: string | null;
  nationalNumber: string | null;
  extension: string | null;
  status: PhoneVerdict;
}

/**
 * Canonical parse used by every phone write path (docs/PHASE2_1_DESIGN.md §1).
 * VALID = the library validates the number pattern; POSSIBLE = length-plausible
 * only (kept dialable — CRM data is messy); INVALID = present but not a
 * plausible number (calling blocked, visibly flagged); MISSING = empty.
 */
export function parsePhoneDetails(
  raw: string | null | undefined,
  region: CountryCode = DEFAULT_REGION
): PhoneDetails {
  const empty: PhoneDetails = {
    normalized: null,
    countryCode: null,
    nationalNumber: null,
    extension: null,
    status: "MISSING",
  };
  if (!raw || !raw.trim()) return empty;
  // Same parse path as normalizePhone — one canonical behavior everywhere.
  const parsed = parseSmart(raw.trim(), region);
  if (!parsed || !parsed.isPossible()) {
    return { ...empty, status: "INVALID" };
  }
  return {
    normalized: parsed.number,
    countryCode: parsed.countryCallingCode ?? null,
    nationalNumber: parsed.nationalNumber ?? null,
    extension: parsed.ext ?? null,
    status: parsed.isValid() ? "VALID" : "POSSIBLE",
  };
}

/** Lead column values for a raw phone — used by every write path + repair. */
export function phoneWriteFields(raw: string | null | undefined): {
  phone: string | null;
  normalizedPhone: string | null;
  phoneCountry: string | null;
  phoneNational: string | null;
  phoneExtension: string | null;
  phoneStatus: PhoneVerdict;
} {
  const details = parsePhoneDetails(raw);
  return {
    phone: raw?.trim() || null,
    normalizedPhone: details.normalized,
    phoneCountry: details.countryCode,
    phoneNational: details.nationalNumber,
    phoneExtension: details.extension,
    phoneStatus: details.status,
  };
}

/** Lowercases and trims an email; returns null when clearly not an email. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  // Minimal structural check; full validation happens via Zod at the boundary.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
