import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CommonJS dev helpers (loaded via NODE_OPTIONS --require) legitimately use require().
    "**/*.cjs",
    // Archived chat-cockpit prototype — not compiled, linted, or tested.
    "legacy/**",
    // Browser extension (Computer C2 bridge): plain MV3 JavaScript with
    // chrome.* globals, packaged separately — its pure extraction core is
    // unit-tested from test/, the packaging files are not part of the app.
    "extension/**",
  ]),
]);

export default eslintConfig;
