/**
 * MediaSync — phone normalization.
 *
 * Pure, dependency-free E.164-style normalization used for cross-channel
 * identity matching. Two numbers written differently ("+383 49 123 456",
 * "0049123456", "0049 123 456") collapse to the same canonical string so the
 * same person reaching out on WhatsApp and SMS resolves to one customer.
 */

/**
 * Canonicalize a phone number to `+<digits>`. Returns null when the input is
 * empty or too short to be a real number.
 *
 * @param defaultCountryCode dialing code (e.g. "383", "+383") used to expand a
 *   national number that has no international prefix.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode?: string | null,
): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Treat a leading "00" as the international prefix "+".
  let international = s.startsWith("+");
  if (s.startsWith("00")) {
    international = true;
    s = s.slice(2);
  }

  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return null; // too short to be a dialable number

  if (international) return `+${digits}`;

  // No international prefix: expand using the workspace default dialing code,
  // dropping a national trunk "0" if present (e.g. "049…" -> "+38349…").
  const cc = defaultCountryCode?.replace(/\D/g, "");
  if (cc) {
    const national = digits.replace(/^0+/, "");
    return `+${cc}${national}`;
  }

  return `+${digits}`;
}

/** True when two raw numbers normalize to the same canonical form. */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
  defaultCountryCode?: string | null,
): boolean {
  const na = normalizePhone(a, defaultCountryCode);
  const nb = normalizePhone(b, defaultCountryCode);
  return na !== null && na === nb;
}
