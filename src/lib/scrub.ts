/**
 * Redaction shared by every runtime (server, edge and browser).
 *
 * Deliberately free of `server-only` and of any Node built-in: the Sentry
 * browser SDK scrubs with the same rules as the server, so a value that is a
 * secret in one runtime cannot leak from the other.
 */

/** Keys whose values must never leave the process, at any nesting depth. */
const SECRET_KEYS = [
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "token",
  "tokenhash",
  "secret",
  "webhooksecret",
  "webhooksecretencrypted",
  "authorization",
  "cookie",
  "cookies",
  "signature",
  "x-operanto-signature",
  "auth_secret",
  "cron_secret",
  "apikey",
  "api_key",
  "sessiontoken",
  "csrftoken",
];

/** Personal data: redacted by default, since it is rarely needed to debug. */
const PII_KEYS = [
  "email",
  "emailnormalized",
  "phone",
  "phonenormalized",
  "name",
  "customername",
  "message",
  "inquirytext",
  "summary",
  "body",
  "rawpayload",
  "payload",
  "data",
];

const SECRET_MASK = "[redacted]";
const PII_MASK = "[pii]";
const MAX_DEPTH = 6;

function classify(key: string): "secret" | "pii" | null {
  const k = key.toLowerCase();
  if (SECRET_KEYS.some((s) => k === s || k.includes(s))) return "secret";
  if (PII_KEYS.some((p) => k === p)) return "pii";
  return null;
}

/**
 * Recursively redact secrets and personal data from an arbitrary structure.
 * Unknown shapes are handled conservatively: anything that is not a plain
 * object, array or primitive is dropped rather than serialised blindly.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Long strings are truncated: a pasted token or dump is still a leak.
    return value.length > 512 ? `${value.slice(0, 512)}…[truncated]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => scrub(entry, depth + 1));
  }
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return "[unserialisable]";

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const kind = classify(key);
      if (kind === "secret") out[key] = SECRET_MASK;
      else if (kind === "pii") out[key] = PII_MASK;
      else out[key] = scrub(entry, depth + 1);
    }
    return out;
  }
  return "[unserialisable]";
}
