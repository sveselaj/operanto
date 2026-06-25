/**
 * MediaSync — inbound consent keyword detection (pure).
 *
 * Messaging compliance (WhatsApp/SMS) requires honoring opt-out keywords.
 * When a customer replies with just "STOP" (or an Albanian equivalent), we flip
 * their consent to opted-out; "START" re-subscribes them. Detection is
 * conservative: it only fires when the whole message is essentially the keyword,
 * so "please stop sending me the wrong size" is NOT treated as an opt-out.
 */

export type ConsentSignal = "opt_out" | "opt_in" | null;

// English + Albanian (the product's first two languages — see BLUEPRINT §18).
const OPT_OUT = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "ndalo",
  "ndal",
  "crregjistrohu",
  "çregjistrohu",
]);

const OPT_IN = new Set(["start", "unstop", "subscribe", "yes", "po", "rifillo"]);

/** Returns the consent signal for a message, or null if it isn't a command. */
export function detectConsentSignal(body: string | null | undefined): ConsentSignal {
  if (!body) return null;
  // Normalize: lowercase, strip surrounding punctuation/whitespace.
  const t = body
    .trim()
    .toLowerCase()
    .replace(/[.!,;:¡¿?'"()]/g, "")
    .trim();
  if (!t || t.includes(" ")) return null; // single-token commands only
  if (OPT_OUT.has(t)) return "opt_out";
  if (OPT_IN.has(t)) return "opt_in";
  return null;
}
