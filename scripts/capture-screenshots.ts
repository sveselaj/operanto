/**
 * Capture documentation screenshots for the User Manual.
 *
 * Drives the running dev app with Playwright, logs in as seeded demo users, and
 * saves a PNG per screen to docs/images/. Comms screens come from Bloom Studio
 * (lana, owner); the operational spine from Lumea Goods (elira, owner). Re-run
 * any time the UI changes — it is idempotent and overwrites existing images.
 *
 * Prereqs:  pnpm dev   (app on :3000)  ·  postgres up  ·  seeded DB
 * Run:      pnpm tsx scripts/capture-screenshots.ts
 */
import "dotenv/config";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/images");
const prisma = new PrismaClient();

type Shot = { name: string; url: string; wait?: string };
const results: { name: string; ok: boolean; note: string }[] = [];

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "operanto");
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20_000 });
}

/** Screenshot a single Card on the current page, located by its title text. */
async function shootEl(page: Page, name: string, heading: string) {
  try {
    const card = page.locator("div.rounded-xl", { has: page.getByText(heading, { exact: true }) }).first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const file = path.join(OUT, `${name}.png`);
    await card.screenshot({ path: file });
    const kb = Math.round(statSync(file).size / 1024);
    results.push({ name, ok: kb > 3, note: `${kb} KB` });
    console.log(`  ${kb > 3 ? "✓" : "✗"} ${name}  (${kb} KB, element)`);
  } catch (e) {
    results.push({ name, ok: false, note: (e as Error).message.split("\n")[0] });
    console.log(`  ✗ ${name}  — ${(e as Error).message.split("\n")[0]}`);
  }
}

async function shoot(page: Page, s: Shot) {
  try {
    await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle", timeout: 30_000 });
    if (s.wait) await page.waitForSelector(s.wait, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(900); // let async panels / charts settle
    const file = path.join(OUT, `${s.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const kb = Math.round(statSync(file).size / 1024);
    results.push({ name: s.name, ok: kb > 5, note: `${kb} KB` });
    console.log(`  ${kb > 5 ? "✓" : "✗"} ${s.name}  (${kb} KB)`);
  } catch (e) {
    results.push({ name: s.name, ok: false, note: (e as Error).message.split("\n")[0] });
    console.log(`  ✗ ${s.name}  — ${(e as Error).message.split("\n")[0]}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // ── Resolve dynamic ids from the seeded DB ────────────────────────────
  const bloom = await prisma.workspace.findUniqueOrThrow({ where: { slug: "bloom-studio" } });
  const lumea = await prisma.workspace.findUniqueOrThrow({ where: { slug: "lumea-goods" } });
  const bloomConv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: bloom.id, customerId: { not: null } },
    orderBy: { lastMessageAt: "desc" },
  });
  const bloomSop = await prisma.sOP.findFirstOrThrow({ where: { workspaceId: bloom.id } });
  const opp = await prisma.opportunity.findFirstOrThrow({
    where: { workspaceId: lumea.id, title: { contains: "necklace" } },
  });
  const quote = await prisma.quote.findFirstOrThrow({ where: { opportunityId: opp.id } });

  // Stage a pending approval so /approvals isn't empty (idempotent).
  const blerim = await prisma.user.findUniqueOrThrow({ where: { email: "blerim@lumeagoods.test" } });
  const existing = await prisma.approvalRequest.findFirst({
    where: { workspaceId: lumea.id, entityType: "Quote", entityId: quote.id, action: "quote.send", status: "pending" },
  });
  if (!existing) {
    await prisma.approvalRequest.create({
      data: {
        workspaceId: lumea.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.send",
        status: "pending",
        requestedByUserId: blerim.id,
        reason: "Send the €141.60 necklace quote to Teuta",
      },
    });
    console.log("  staged a pending approval for the approvals screen");
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // ── 0) Login screen (unauthenticated) ─────────────────────────────────
  console.log("\nAuth screens");
  await shoot(page, { name: "00-login", url: "/login", wait: 'button:has-text("Sign in")' });

  // ── Bloom Studio (owner) — communication + MVP modules ────────────────
  console.log("\nBloom Studio (comms modules)");
  await login(page, "lana@bloomstudio.test");
  await shoot(page, { name: "01-select-workspace", url: "/select-workspace" });
  await shoot(page, { name: "10-command", url: `/${bloom.slug}/command` });
  await shoot(page, { name: "11-inbox", url: `/${bloom.slug}/inbox` });
  await shoot(page, { name: "12-inbox-conversation", url: `/${bloom.slug}/inbox/${bloomConv.id}` });
  await shoot(page, { name: "13-tasks", url: `/${bloom.slug}/tasks` });
  await shoot(page, { name: "14-sops", url: `/${bloom.slug}/sops` });
  await shoot(page, { name: "15-sop-detail", url: `/${bloom.slug}/sops/${bloomSop.id}` });
  await shoot(page, { name: "16-studio", url: `/${bloom.slug}/studio` });
  await shoot(page, { name: "17-intelligence", url: `/${bloom.slug}/intelligence` });
  await shoot(page, { name: "18-automations", url: `/${bloom.slug}/automations` });
  await shoot(page, { name: "19-team", url: `/${bloom.slug}/team` });
  await shoot(page, { name: "20-settings", url: `/${bloom.slug}/settings` });
  await shoot(page, { name: "21-settings-templates", url: `/${bloom.slug}/settings/templates` });

  // ── Lumea Goods (owner) — operational spine ───────────────────────────
  console.log("\nLumea Goods (operational spine)");
  await ctx.clearCookies();
  await login(page, "elira@lumeagoods.test");
  await shoot(page, { name: "30-opportunities", url: `/${lumea.slug}/opportunities` });
  await shoot(page, { name: "31-opportunity-detail", url: `/${lumea.slug}/opportunities/${opp.id}` });
  // Focused cards on the (already-loaded) opportunity page — features with no standalone route.
  await shootEl(page, "31a-appointments-card", "Appointments");
  await shootEl(page, "31b-documents-card", "Documents");
  await shoot(page, { name: "32-quote-detail", url: `/${lumea.slug}/opportunities/${opp.id}/quotes/${quote.id}` });
  await shoot(page, { name: "33-approvals", url: `/${lumea.slug}/approvals` });
  await shoot(page, { name: "34-settings-catalogue", url: `/${lumea.slug}/settings/catalogue` });
  await shoot(page, { name: "35-settings-integrations", url: `/${lumea.slug}/settings/integrations` });
  await shoot(page, { name: "36-settings-diagnostics", url: `/${lumea.slug}/settings/diagnostics` });

  await browser.close();

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} screenshots captured → ${OUT}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log("FAILED:", failed.map((f) => `${f.name} (${f.note})`).join(", "));
}

main()
  .catch((e) => {
    console.error("CAPTURE FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
