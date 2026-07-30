/**
 * Identity normalization for customer matching. These keys are used only for
 * EXACT matching (see docs/customer-matching.md) — never fuzzy merging.
 */

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

/**
 * Phone → digits only, preserving international form ("+" or "00" prefix) as
 * a leading "+". No country-code inference: a local number and its
 * international form intentionally do NOT match — creating a second customer
 * is safer than merging the wrong two people.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 6) return null;
  return international ? `+${digits}` : digits;
}
