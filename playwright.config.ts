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
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1, // shared database state — strictly sequential
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 90_000,
    env: {
      // Fresh events are immediately claimable by the retry sweep, so tests
      // can drive processing deterministically through the real CRON path.
      OPERANTO_STALE_EVENT_MINUTES: "0",
    },
  },
});
