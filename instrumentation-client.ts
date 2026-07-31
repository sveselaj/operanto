import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/sentry-options";

// Browser error capture. Without NEXT_PUBLIC_SENTRY_DSN this is a no-op.
const options = sentryBaseOptions();
if (options.dsn) {
  Sentry.init({ ...options, replaysOnErrorSampleRate: 0, replaysSessionSampleRate: 0 });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
