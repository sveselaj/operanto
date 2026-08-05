import {
  normalizeEmail,
  normalizePhone,
  parsePhoneDetails,
  phoneWriteFields,
} from "./normalize";

/**
 * Stable service facade over the phone engine (OI-2 contract). Thin, additive
 * aliases — the underlying functions keep their existing names and behavior;
 * consumers may use either surface. Two modes exist deliberately:
 *
 * - `forMatching` — conservative identity key; used by duplicate detection and
 *   (at OI-5+) the platform identity ladder. Region inference applies the
 *   documented CRM default (DE) — the Operanto customer ladder additionally
 *   restricts itself to inputs that prove their country (`+`/`00`), per
 *   docs/OPERANTO_CRM_INTEGRATION.md §10.
 * - `forDialing` — full parse with components and verdict; the ONLY input for
 *   persisted phone fields (`phoneWriteFields`).
 */
export const PhoneService = {
  /** Canonical E.164 matching key (null when unparseable). */
  normalize: normalizePhone,
  /** Full parse: components, display/dial formats, validation verdict. */
  parse: parsePhoneDetails,
  /** The one write shape for persisted phone fields (raw + E.164 + components + verdict). */
  writeFields: phoneWriteFields,
  /** Canonical email matching key. */
  normalizeEmail,
  forMatching: normalizePhone,
  forDialing: parsePhoneDetails,
} as const;
