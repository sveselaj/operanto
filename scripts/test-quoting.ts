/**
 * Phase B+C integration check — Catalogue + Quoting.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-quoting.ts
 */
import { PrismaClient } from "@prisma/client";
import * as quotes from "../src/lib/services/quotes";
import type { WorkspaceContext } from "../src/lib/workspace";

const prisma = new PrismaClient();
const num = (d: unknown) => (d == null ? 0 : Number((d as { toString(): string }).toString()));
let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${n}`);
  ok ? pass++ : fail++;
};

async function ctxFor(slug: string, email: string): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const member = await prisma.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  return { workspace, member, userId: user.id };
}

async function main() {
  const ctx = await ctxFor("lumea-goods", "blerim@lumeagoods.test"); // agent: quotes:manage
  const opp = await prisma.opportunity.findFirstOrThrow({
    where: { workspaceId: ctx.workspace.id, title: { contains: "necklace" } },
  });
  const created: string[] = [];

  // 1) AI-draft a quote (mock mode) — builds a line from catalogue + requirements
  const q = await quotes.draftQuote(ctx, opp.id);
  created.push(q.id);
  const full = await quotes.getQuote(ctx, q.id);
  check("draft produced at least one line", (full?.lines.length ?? 0) >= 1);
  check("line uses the catalogue unit price (120)", full?.lines.some((l) => num(l.unitPrice) === 120) ?? false);
  check("totals computed (subtotal 120, tax 21.6, total 141.6)",
    num(full?.subtotal) === 120 && num(full?.taxTotal) === 21.6 && num(full?.total) === 141.6);

  // 2) Add a line → totals recompute
  const shipping = await prisma.product.findFirstOrThrow({
    where: { workspaceId: ctx.workspace.id, name: "Express shipping" },
  });
  await quotes.addLine(ctx, q.id, { productId: shipping.id, description: "Express shipping", quantity: 1, unitPrice: 15, taxRate: 0 });
  const q2 = await quotes.getQuote(ctx, q.id);
  check("adding a line recomputed the total (156.6)", num(q2?.total) === 156.6);

  // 3) Edit a line quantity → recompute
  const shipLine = q2!.lines.find((l) => l.description === "Express shipping")!;
  await quotes.updateLine(ctx, shipLine.id, { quantity: 2 });
  const q3 = await quotes.getQuote(ctx, q.id);
  check("editing quantity recomputed the total (171.6)", num(q3?.total) === 171.6);

  // 4) Remove the line → back to the necklace-only total
  await quotes.removeLine(ctx, shipLine.id);
  const q4 = await quotes.getQuote(ctx, q.id);
  check("removing a line recomputed the total (141.6)", num(q4?.total) === 141.6);

  // 5) Business rule: enable the 5% returning-customer discount, re-draft
  await prisma.businessRule.updateMany({
    where: { workspaceId: ctx.workspace.id, name: "Returning customer 5%" },
    data: { enabled: true },
  });
  const q5 = await quotes.draftQuote(ctx, opp.id);
  created.push(q5.id);
  const full5 = await quotes.getQuote(ctx, q5.id);
  check("rule added a discount adjustment line", full5?.lines.some((l) => l.description.includes("Returning customer")) ?? false);
  check("discount reduced the total below 141.6", num(full5?.total) < 141.6);
  await prisma.businessRule.updateMany({
    where: { workspaceId: ctx.workspace.id, name: "Returning customer 5%" },
    data: { enabled: false },
  });

  // 6) Status transition stamps sentAt
  await quotes.updateQuote(ctx, q.id, { status: "sent" });
  const q6 = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
  check("sending a quote stamps sentAt", q6.sentAt !== null && q6.status === "sent");

  // 7) Tenant isolation
  const bloom = await ctxFor("bloom-studio", "lana@bloomstudio.test");
  check("cross-tenant getQuote returns null", (await quotes.getQuote(bloom, q.id)) === null);

  // Cleanup the quotes this test created (seed quote remains).
  await prisma.quoteLine.deleteMany({ where: { quoteId: { in: created } } });
  await prisma.quote.deleteMany({ where: { id: { in: created } } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
