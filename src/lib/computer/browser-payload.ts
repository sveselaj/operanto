import { z } from "zod";
import {
  COMPUTER_LIMITS,
  computerSemanticSchema,
  type ComputerSemanticElement,
} from "@/lib/computer/policy";

/**
 * Authoritative server-side sanitizer for browser-bridge payloads (C2).
 *
 * The extension performs the same filtering client-side, but the extension
 * is an UNTRUSTED CLIENT like any other: whatever arrives here is validated
 * as if it were hostile. Fail closed — a payload that smuggles unknown keys
 * (values, cookies, tokens, coordinates) is REJECTED, not trimmed.
 *
 * What never passes this boundary, by construction:
 * - form field values of any kind (elements are role + accessible name);
 * - password/2FA/token/cookie/storage material (no field exists for them);
 * - URL query strings and fragments (routinely carry tokens and PII —
 *   only origin + pathname survive);
 * - unbounded page dumps (hard caps on text, title, element count).
 *
 * Everything that DOES pass remains UNTRUSTED OBSERVATION DATA in the
 * injection sense: it is stored, redacted and displayed as data; no service
 * reads it to decide policy, status, approval, routing or lifecycle.
 */

export const BROWSER_PAYLOAD_LIMITS = {
  /** Raw visible text accepted from the extension before bounding. */
  rawTextMax: 16_000,
  /** Persisted visible-text bound (matches ComputerSnapshot). */
  storedTextMax: COMPUTER_LIMITS.snapshotText,
  urlMax: COMPUTER_LIMITS.snapshotUrl,
  titleMax: COMPUTER_LIMITS.snapshotTitle,
  elementsMax: COMPUTER_LIMITS.semanticElements,
  captureIdMax: 64,
} as const;

const browserPayloadSchema = z
  .object({
    url: z.string().min(1).max(BROWSER_PAYLOAD_LIMITS.urlMax),
    title: z.string().max(BROWSER_PAYLOAD_LIMITS.titleMax).optional(),
    visibleText: z.string().max(BROWSER_PAYLOAD_LIMITS.rawTextMax).optional(),
    elements: computerSemanticSchema.optional(),
    /** Client-minted id for replay idempotency (uuid-like, bounded). */
    captureId: z
      .string()
      .min(8)
      .max(BROWSER_PAYLOAD_LIMITS.captureIdMax)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();

export type SanitizedBrowserPayload = {
  /** origin + pathname only — query and fragment are dropped. */
  url: string;
  pageTitle: string | null;
  visibleTextSummary: string | null;
  elements: ComputerSemanticElement[] | null;
  captureId: string | null;
};

export class BrowserPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserPayloadError";
  }
}

/**
 * Strip a page URL to origin + pathname. Query strings and fragments are
 * dropped unconditionally: they routinely carry session tokens, magic
 * links, and personal identifiers. Only http(s) pages are observable.
 */
export function sanitizePageUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BrowserPayloadError("URL is not a valid absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BrowserPayloadError("Only http(s) pages can be observed");
  }
  if (parsed.username || parsed.password) {
    throw new BrowserPayloadError("URLs with embedded credentials are refused");
  }
  const stripped = `${parsed.origin}${parsed.pathname}`;
  return stripped.length > BROWSER_PAYLOAD_LIMITS.urlMax
    ? stripped.slice(0, BROWSER_PAYLOAD_LIMITS.urlMax)
    : stripped;
}

/**
 * Validate and sanitize one extension payload. Throws BrowserPayloadError
 * (or ZodError) on anything out of contract — unknown keys anywhere,
 * value-bearing elements, oversized content, non-http URLs.
 */
export function sanitizeBrowserPayload(raw: unknown): SanitizedBrowserPayload {
  const parsed = browserPayloadSchema.parse(raw);
  const url = sanitizePageUrl(parsed.url);
  const text = parsed.visibleText?.trim() ?? "";
  return {
    url,
    pageTitle: parsed.title?.trim() ? parsed.title.trim() : null,
    visibleTextSummary: text
      ? text.slice(0, BROWSER_PAYLOAD_LIMITS.storedTextMax)
      : null,
    elements: parsed.elements ?? null,
    captureId: parsed.captureId ?? null,
  };
}
