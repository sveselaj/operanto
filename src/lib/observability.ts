import "server-only";

/**
 * Error reporting boundary.
 *
 * Operanto handles customer names, emails, phone numbers and free-text
 * inquiries, plus webhook secrets and invitation tokens. An error reporter
 * that forwards raw request data would quietly become the largest PII and
 * secret leak in the system, so scrubbing lives HERE — provider-agnostic and
 * unit-tested — rather than in a vendor config that is easy to get wrong.
 *
 * Without SENTRY_DSN this module is a no-op beyond local logging, so local
 * development and CI need no credentials. `sendToSentry` is the only place a
 * provider SDK is wired in; see docs/observability.md for the installation
 * steps the owner performs once DSNs exist.
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

export type ErrorContext = {
  /** Coarse location, e.g. "events.process" or "auth.login". */
  scope: string;
  /** Safe correlation handles only — ids, event types, counts. */
  tags?: Record<string, string | number | undefined>;
  /** Additional detail; scrubbed before it leaves the process. */
  extra?: Record<string, unknown>;
};

export function observabilityConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/** Environment and release tags, so staging noise never masks production. */
export function releaseInfo() {
  // `||` rather than `??`: an env var present but empty must fall through,
  // which `??` would not do.
  return {
    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV ||
      "development",
    release:
      process.env.SENTRY_RELEASE ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      "unknown",
  };
}

/**
 * Report an error. Always logs locally; forwards only when a DSN exists.
 * Never throws — an observability failure must not become an outage.
 */
export async function captureError(
  error: unknown,
  context: ErrorContext,
): Promise<void> {
  const payload = {
    ...releaseInfo(),
    scope: context.scope,
    tags: context.tags ?? {},
    extra: scrub(context.extra ?? {}) as Record<string, unknown>,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: "NonError", message: String(error) },
  };

  console.error(`[${context.scope}]`, payload.error.message, {
    tags: payload.tags,
    extra: payload.extra,
  });

  if (!observabilityConfigured()) return;
  try {
    await sendToSentry(payload);
  } catch {
    // Deliberately swallowed: see the contract above.
  }
}

/**
 * Provider hand-off. Left unimplemented until DSNs exist and the SDK is
 * installed (docs/observability.md) — wiring an SDK we cannot exercise would
 * be untested code in the error path, which is the worst place for it.
 */
async function sendToSentry(_payload: unknown): Promise<void> {
  return;
}
