/**
 * Dev helper: prints the CURRENT 2FA code for the locally seeded fixture
 * accounts (enrolled with SEED_TEST_TOTP_SECRET when the seed ran with
 * SEED_TEST_USERS=1). Local development only — production accounts use a
 * real authenticator app and this secret never exists there.
 *
 * Run: pnpm tsx scripts/dev-totp.ts
 */
import { readFileSync } from "node:fs";
import { generateTotp } from "../src/lib/totp";

const line = readFileSync(".env", "utf8")
  .split("\n")
  .find((l) => l.startsWith("SEED_TEST_TOTP_SECRET="));
if (!line) throw new Error("SEED_TEST_TOTP_SECRET missing in .env");
const secret = line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "").trim();

const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Code: ${generateTotp(secret)}  (valid ~${secondsLeft}s more)`);
