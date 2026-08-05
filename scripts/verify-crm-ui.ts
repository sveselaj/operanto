/**
 * OI-3 visual verification driver (dev-only; not part of any suite).
 * Logs in as the seeded fixture admin (2FA via the shared test TOTP secret),
 * walks the new /crm/leads surfaces and saves screenshots.
 * Run: pnpm tsx scripts/verify-crm-ui.ts
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { generateTotp } from "../src/lib/totp";

const OUT = process.env.CRM_SHOT_DIR ?? "/tmp";
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);

const email = env.SEED_ADMIN_EMAIL;
const password = env.SEED_ADMIN_PASSWORD;
const totpSecret = env.SEED_TEST_TOTP_SECRET;
if (!email || !password || !totpSecret) throw new Error("seed envs missing");

async function main() {
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://localhost:3000/login");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
const tokenField = page.getByLabel("Authentication code");
await Promise.race([
  page.waitForURL("**/dashboard").catch(() => undefined),
  tokenField.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined),
]);
if (await tokenField.isVisible().catch(() => false)) {
  await tokenField.fill(generateTotp(totpSecret));
  await page.getByRole("button", { name: "Sign in" }).click();
}
await page.waitForURL("**/dashboard", { timeout: 20_000 });
console.log("LOGIN OK");

// OI-4 surfaces: work queue, call workspace, notification bell.
await page.goto("http://localhost:3000/crm/queue");
await page.getByRole("heading", { name: "Work queue" }).waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${OUT}/oi4-work-queue.png` });
console.log("QUEUE OK — entries:", await page.locator("ol li").count());

await page.goto("http://localhost:3000/crm/leads");
await page.getByRole("link", { name: "Arta Muster (Demo)" }).click();
await page.getByRole("button", { name: /^Call / }).waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: /^Call / }).click();
await page.getByLabel("Outcome").waitFor({ timeout: 30_000 });
await page.getByLabel("Outcome").selectOption("NO_ANSWER");
await page.getByLabel("Follow-up").waitFor({ timeout: 5_000 });
await page.screenshot({ path: `${OUT}/oi4-call-workspace.png` });
console.log("CALL WORKSPACE OK — follow-up options:", await page.getByLabel("Follow-up").locator("option").allTextContents());

await page.goto("http://localhost:3000/notifications");
await page.getByRole("heading", { name: "Notifications" }).waitFor({ timeout: 30_000 });
console.log("NOTIFICATIONS PAGE OK; bell visible:", await page.getByLabel(/Notifications/).first().isVisible());

await page.goto("http://localhost:3000/integrations");
await page.getByText("Telephony", { exact: true }).waitFor({ timeout: 20_000 });
await page.locator("#telephony-provider").selectOption("twilio");
await page.getByLabel("Account SID").waitFor({ timeout: 5_000 });
await page.screenshot({ path: `${OUT}/oi-voice-settings.png` });
console.log("TELEPHONY FORM OK — provider fields adapt");

await page.goto("http://localhost:3000/crm/leads");
console.log("LANDED AT:", page.url());
await page.getByRole("heading", { name: "Leads" }).waitFor({ timeout: 20_000 });
await page.getByText("Miriam Beispiel (Demo)").waitFor({ timeout: 10_000 });
await page.screenshot({ path: `${OUT}/oi3-leads-list.png` });
console.log("LIST OK — sidebar CRM group:", await page.getByText("CRM", { exact: true }).isVisible());

await page.getByRole("link", { name: "Arta Muster (Demo)" }).click();
await page.getByText("Status history").waitFor({ timeout: 20_000 });
await page.screenshot({ path: `${OUT}/oi3-lead-detail.png` });
console.log("DETAIL OK — callback shown:", await page.getByText("Callback:").isVisible());

console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
}

void main();
