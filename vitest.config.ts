import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
  resolve: {
    alias: [
      // `server-only` throws outside a React Server Component; stub it in tests.
      {
        find: "server-only",
        replacement: fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      },
      // Mirror the tsconfig `@/*` -> `src/*` path alias.
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) },
    ],
  },
});
