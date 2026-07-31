import "server-only";
import { scrub } from "@/lib/scrub";

export { scrub } from "@/lib/scrub";

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
 * Provider hand-off. The payload arriving here is already scrubbed; the SDK's
 * own `beforeSend` (src/lib/sentry-options.ts) scrubs anything the SDK
 * captures on its own.
 */
async function sendToSentry(payload: {
  scope: string;
  tags: Record<string, string | number | undefined>;
  extra: Record<string, unknown>;
  error: { name: string; message: string; stack?: string };
}): Promise<void> {
  const Sentry = await import("@sentry/nextjs");
  const error = new Error(payload.error.message);
  error.name = payload.error.name;
  if (payload.error.stack) error.stack = payload.error.stack;

  Sentry.withScope((scope) => {
    scope.setTag("scope", payload.scope);
    for (const [key, value] of Object.entries(payload.tags)) {
      if (value !== undefined) scope.setTag(key, String(value));
    }
    scope.setContext("operanto", payload.extra);
    Sentry.captureException(error);
  });
}
