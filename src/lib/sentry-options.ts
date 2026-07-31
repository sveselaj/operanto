import type { ErrorEvent } from "@sentry/nextjs";
import { scrub } from "@/lib/scrub";

/**
 * Shared Sentry options for the server, edge and browser runtimes.
 *
 * The `beforeSend` hook is the last line of defence: `captureError()` already
 * scrubs everything it forwards, but the SDK also captures unhandled errors
 * on its own, and those arrive with request data attached. Anything leaving
 * this process passes through `scrub()` first.
 */
export function sentryBaseOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.NEXT_PUBLIC_VERCEL_ENV ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV ||
      "development",
    release:
      process.env.SENTRY_RELEASE ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      undefined,
    // Never attach IPs, cookies or user identifiers automatically.
    sendDefaultPii: false,
    // Errors only for now; performance sampling can be raised deliberately.
    tracesSampleRate: 0,
    beforeSend(event: ErrorEvent): ErrorEvent | null {
      // Request bodies carry inquiry text, names, emails and phone numbers.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const header of [
            "authorization",
            "cookie",
            "x-operanto-signature",
          ]) {
            delete event.request.headers[header];
          }
        }
        // Query strings can carry invitation tokens and search terms.
        event.request.query_string = undefined;
      }
      // The user object would otherwise carry email/ip_address.
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      if (event.extra) {
        event.extra = scrub(event.extra) as Record<string, unknown>;
      }
      if (event.contexts) {
        event.contexts = scrub(event.contexts) as typeof event.contexts;
      }
      return event;
    },
  };
}
