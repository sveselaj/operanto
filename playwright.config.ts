import "dotenv/config";
import { defineConfig } from "@playwright/test";

/**
 * Acceptance tests for the decisive journey. They exercise the REAL ingestion
 * route (signed HTTP requests) and the real authenticated Cockpit against the
 * database configured in .env — run them only against local or staging
 * databases, never production.
 *
 * Requires: `pnpm build` beforehand, and a seed with SEED_TEST_USERS=1.
 */
// Set PLAYWRIGHT_BASE_URL (e.g. https://staging.operanto.ai) to run the suite
// against a deployed environment instead of a locally started server. The
// remote deployment must run with OPERANTO_STALE_EVENT_MINUTES=0 only if you
// need deterministic sweep timing; otherwise processing normally completes via
// after() and the suite's sweep polling simply confirms it.
const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1, // shared database state — strictly sequential
  reporter: [["list"]],
  use: {
    baseURL: remoteBaseUrl ?? "http://localhost:3000",
  },
  // Locally the app is rebuilt with single-host URLs: NEXT_PUBLIC_* values are
  // inlined at build time, so a build carrying the real hostnames would (very
  // correctly) 404 every API call arriving on localhost. Host separation
  // itself is covered by src/proxy.test.ts and, on staging, by running this
  // suite with PLAYWRIGHT_BASE_URL against the real hosts.
  //
  // No stale-window override: shrinking it to zero would let the retry sweep
  // re-claim events that after() is still processing. Per-event completion is
  // confirmed via /api/internal/events/status, and retryPendingEvents itself
  // is unit-tested in src/lib/events/process.test.ts.
  webServer: remoteBaseUrl
    ? undefined
    : {
        // `pnpm test:e2e` rebuilds with the localhost URLs first; AUTH_URL is
        // read at runtime, so the local value must be set here as well or the
        // sign-in callback would redirect to the staging host.
        command: "pnpm start",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: false,
        timeout: 120_000,
        env: { AUTH_URL: "http://localhost:3000" },
      },
});
