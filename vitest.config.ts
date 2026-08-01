import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Shared with vitest.integration.config.ts, so the two cannot drift apart. */
export const testAliases = [
  // `server-only` throws outside a React Server Component; stub it in tests.
  {
    find: "server-only",
    replacement: fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
  },
  // Mirror the tsconfig `@/*` -> `src/*` path alias.
  { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) },
];

export default defineConfig({
  test: {
    environment: "node",
    // *.integration.test.ts is excluded here and run by `pnpm test:integration`
    // (vitest.integration.config.ts). Those need a real database and must run
    // serially; leaving them in this glob would silently parallelise them on
    // any machine that happens to export TEST_DATABASE_URL.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
  resolve: { alias: testAliases },
});
