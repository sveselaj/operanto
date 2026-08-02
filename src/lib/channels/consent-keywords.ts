/**
 * Consent keyword detection — pure. Inbound STOP/START style messages update
 * the per-channel consent record; every future outbound send must check that
 * record before transmitting anything.
 */

const STOP_WORDS = ["stop", "unsubscribe", "opt out", "opt-out", "ndalo"];
const START_WORDS = ["start", "subscribe", "opt in", "opt-in", "fillo"];

export type ConsentSignal = "opt_out" | "opt_in" | null;

export function detectConsentSignal(body: string): ConsentSignal {
  const normalized = body.trim().toLowerCase();
  // Keyword semantics only apply to short, deliberate messages — "please
  // don't stop looking for apartments" is not an opt-out.
  if (normalized.length > 40) return null;
  if (STOP_WORDS.some((w) => normalized === w || normalized.startsWith(`${w} `))) {
    return "opt_out";
  }
  if (START_WORDS.some((w) => normalized === w || normalized.startsWith(`${w} `))) {
    return "opt_in";
  }
  return null;
}
