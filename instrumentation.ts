import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/sentry-options";

/**
 * Server and edge runtime initialisation. No DSN means Sentry.init is a
 * no-op, so local development and CI need no credentials.
 */
export async function register() {
  const options = sentryBaseOptions();
  if (!options.dsn) return;
  Sentry.init(options);
}

export const onRequestError = Sentry.captureRequestError;
