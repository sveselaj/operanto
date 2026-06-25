import "server-only";
import type { Prisma, QuoteStatus, TaxMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { computeQuoteTotals, type LineInput } from "@/lib/quote-totals";
import { evaluateRules } from "@/lib/business-rules";
import { runAITask } from "@/lib/ai/service";
import { draftQuoteTask } from "@/lib/ai/tasks";

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export function listQuotes(ctx: WorkspaceContext, opportunityId: string) {
  requirePermission(ctx.member.role, "quotes:manage");
  return prisma.quote.findMany({
    where: { workspaceId: ctx.workspace.id, opportunityId },
    orderBy: { createdAt: "desc" },
  });
}

export function getQuote(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "quotes:manage");
  return prisma.quote.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: {
      lines: { orderBy: { position: "asc" } },
      opportunity: { include: { customer: true } },
    },
  });
}

async function assertQuote(ctx: WorkspaceContext, id: string) {
  const q = await prisma.quote.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true, taxMode: true, status: true },
  });
  if (!q) throw new Error("Quote not found");
  return q;
}

async function assertOpportunity(ctx: WorkspaceContext, opportunityId: string) {
  const o = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!o) throw new Error("Opportunity not found");
}

/** Recompute and persist quote + line totals from the current lines. */
async function recompute(quoteId: string, taxMode: TaxMode) {
  const lines = await prisma.quoteLine.findMany({
    where: { quoteId },
    orderBy: { position: "asc" },
  });
  const inputs: LineInput[] = lines.map((l) => ({
    quantity: num(l.quantity),
    unitPrice: num(l.unitPrice),
    discount: num(l.discount),
    taxRate: l.taxRate,
  }));
  const totals = computeQuoteTotals(inputs, taxMode);
  await prisma.$transaction([
    ...lines.map((l, i) =>
      prisma.quoteLine.update({ where: { id: l.id }, data: { lineTotal: totals.lines[i].lineTotal } }),
    ),
    prisma.quote.update({
      where: { id: quoteId },
      data: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    }),
  ]);
  return totals;
}

export async function createQuote(ctx: WorkspaceContext, opportunityId: string) {
  requirePermission(ctx.member.role, "quotes:manage");
  await assertOpportunity(ctx, opportunityId);
  const quote = await prisma.quote.create({
    data: {
      workspaceId: ctx.workspace.id,
      opportunityId,
      currency: ctx.workspace.defaultCurrency,
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "quote.create", entity: "Quote", entityId: quote.id });
  return quote;
}

export type LineInputData = {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
};

export async function addLine(ctx: WorkspaceContext, quoteId: string, input: LineInputData) {
  requirePermission(ctx.member.role, "quotes:manage");
  const quote = await assertQuote(ctx, quoteId);
  const count = await prisma.quoteLine.count({ where: { quoteId } });
  let productId = input.productId ?? null;
  if (productId) {
    const p = await prisma.product.findFirst({
      where: { id: productId, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!p) productId = null;
  }
  await prisma.quoteLine.create({
    data: {
      quoteId,
      productId,
      description: input.description.trim() || "Item",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discount: input.discount ?? 0,
      taxRate: input.taxRate ?? ctx.workspace.defaultTaxRate,
      position: count,
    },
  });
  await recompute(quoteId, quote.taxMode);
  await audit(ctx, { action: "quote.line.add", entity: "Quote", entityId: quoteId });
}

export async function updateLine(
  ctx: WorkspaceContext,
  lineId: string,
  patch: Partial<Omit<LineInputData, "productId">>,
) {
  requirePermission(ctx.member.role, "quotes:manage");
  const line = await prisma.quoteLine.findFirst({
    where: { id: lineId, quote: { workspaceId: ctx.workspace.id } },
    include: { quote: { select: { id: true, taxMode: true } } },
  });
  if (!line) throw new Error("Quote line not found");
  await prisma.quoteLine.update({
    where: { id: lineId },
    data: {
      ...(patch.description !== undefined ? { description: patch.description.trim() || "Item" } : {}),
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.unitPrice !== undefined ? { unitPrice: patch.unitPrice } : {}),
      ...(patch.discount !== undefined ? { discount: patch.discount } : {}),
      ...(patch.taxRate !== undefined ? { taxRate: patch.taxRate } : {}),
    },
  });
  await recompute(line.quote.id, line.quote.taxMode);
}

export async function removeLine(ctx: WorkspaceContext, lineId: string) {
  requirePermission(ctx.member.role, "quotes:manage");
  const line = await prisma.quoteLine.findFirst({
    where: { id: lineId, quote: { workspaceId: ctx.workspace.id } },
    include: { quote: { select: { id: true, taxMode: true } } },
  });
  if (!line) throw new Error("Quote line not found");
  await prisma.quoteLine.delete({ where: { id: lineId } });
  await recompute(line.quote.id, line.quote.taxMode);
}

export async function updateQuote(
  ctx: WorkspaceContext,
  id: string,
  patch: { status?: QuoteStatus; notes?: string | null; validUntil?: string | null; taxMode?: TaxMode },
) {
  requirePermission(ctx.member.role, "quotes:manage");
  const before = await assertQuote(ctx, id);
  const data: Prisma.QuoteUpdateInput = {};
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.validUntil !== undefined) data.validUntil = patch.validUntil ? new Date(patch.validUntil) : null;
  if (patch.taxMode !== undefined) data.taxMode = patch.taxMode;
  if (patch.status !== undefined) {
    data.status = patch.status;
    if (patch.status === "approved") data.approvedByUserId = ctx.userId;
    if (patch.status === "sent") data.sentAt = new Date();
    if (patch.status === "accepted") data.acceptedAt = new Date();
  }
  await prisma.quote.update({ where: { id }, data });
  if (patch.taxMode && patch.taxMode !== before.taxMode) await recompute(id, patch.taxMode);
  await audit(ctx, { action: "quote.update", entity: "Quote", entityId: id, after: patch });
}

/**
 * AI-draft a quote for an opportunity: build lines from requirements + catalogue,
 * then apply business-rule pricing modifiers as adjustment lines and surface any
 * rule violations in the notes.
 */
export async function draftQuote(ctx: WorkspaceContext, opportunityId: string) {
  requirePermission(ctx.member.role, "quotes:manage");
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: ctx.workspace.id },
    include: { customer: true, requirements: true },
  });
  if (!opp) throw new Error("Opportunity not found");

  const products = await prisma.product.findMany({
    where: { workspaceId: ctx.workspace.id, active: true },
  });

  const res = await runAITask(ctx, draftQuoteTask, {
    customerName: opp.customer?.name ?? null,
    currency: ctx.workspace.defaultCurrency,
    requirements: opp.requirements.map((r) => ({ label: r.label, value: r.value })),
    products: products.map((p) => ({
      name: p.name,
      sku: p.sku,
      unitPrice: p.unitPrice == null ? null : num(p.unitPrice),
      taxRate: p.taxRate,
      unit: p.unit,
    })),
  });

  const quote = await createQuote(ctx, opportunityId);

  // Product lines from the AI draft (match a catalogue product by name).
  let position = 0;
  for (const l of res.data.lines) {
    const match = products.find((p) => p.name.toLowerCase() === l.description.toLowerCase());
    await prisma.quoteLine.create({
      data: {
        quoteId: quote.id,
        productId: match?.id ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        position: position++,
      },
    });
  }

  // Apply business-rule pricing modifiers + collect violations.
  const draftTotals = computeQuoteTotals(
    res.data.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: 0, taxRate: l.taxRate })),
    quote.taxMode,
  );
  const rules = await prisma.businessRule.findMany({
    where: { workspaceId: ctx.workspace.id, enabled: true },
  });
  const evaluation = evaluateRules(
    rules.map((r) => ({ name: r.name, priority: r.priority, definition: r.definition })),
    {
      subtotal: draftTotals.subtotal,
      location: opp.customer?.location ?? null,
      providedRequirementKeys: opp.requirements.filter((r) => r.status === "provided").map((r) => r.key),
    },
  );
  for (const adj of evaluation.adjustments) {
    await prisma.quoteLine.create({
      data: {
        quoteId: quote.id,
        description: adj.label,
        quantity: 1,
        unitPrice: adj.amount, // negative for discounts
        taxRate: 0,
        position: position++,
      },
    });
  }

  const notes = [res.data.notes, evaluation.violations.length ? `⚠️ ${evaluation.violations.join("; ")}` : null]
    .filter(Boolean)
    .join("\n");
  if (notes) await prisma.quote.update({ where: { id: quote.id }, data: { notes } });

  await recompute(quote.id, quote.taxMode);
  await audit(ctx, {
    action: "quote.draft",
    entity: "Quote",
    entityId: quote.id,
    after: { lines: res.data.lines.length, adjustments: evaluation.adjustments.length },
  });
  return quote;
}
