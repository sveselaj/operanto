import { defineConfig } from "vitest/config";
import { testAliases } from "./vitest.config";

/**
 * Integration tests: erasure, retention and the second-factor races, against a
 * real disposable PostgreSQL database (`TEST_DATABASE_URL`).
 *
 * They live behind their own config for two reasons. They must not run in the
 * default `pnpm test` — that runs on every machine and in the `verify` CI job,
 * neither of which has a database. And they must not run in parallel workers:
 * they share one database and truncate the same tables, so concurrent files
 * would delete each other's fixtures mid-test.
 *
 * Defined standalone rather than via mergeConfig, which concatenates the glob
 * arrays instead of replacing them and so silently keeps the base exclusion.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
  },
  resolve: { alias: testAliases },
});
