import "server-only";
import { prisma } from "@/lib/prisma";
import { computeQuoteTotals, type LineInput } from "@/lib/quote-totals";

const num = (d: { toString(): string } | number | null | undefined) =>
  d == null ? 0 : Number(d.toString());

/**
 * Recompute and persist a quote's line + header totals from its current lines.
 * Shared by the quotes service and approval effects (kept standalone to avoid a
 * service import cycle).
 */
export async function recomputeQuote(quoteId: string) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { taxMode: true } });
  if (!quote) return;
  const lines = await prisma.quoteLine.findMany({ where: { quoteId }, orderBy: { position: "asc" } });
  const inputs: LineInput[] = lines.map((l) => ({
    quantity: num(l.quantity),
    unitPrice: num(l.unitPrice),
    discount: num(l.discount),
    taxRate: l.taxRate,
  }));
  const totals = computeQuoteTotals(inputs, quote.taxMode);
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
