/**
 * Quote totals (pure). Single source of truth for line and quote math, so the
 * service and the UI never disagree. Supports tax-exclusive and tax-inclusive
 * pricing, and negative lines (e.g. a discount/adjustment line from a rule).
 */

export type TaxMode = "exclusive" | "inclusive";

export type LineInput = {
  quantity: number;
  unitPrice: number;
  discount: number; // absolute, applied to the line's list amount
  taxRate: number; // %
};

export type LineComputed = LineInput & {
  net: number; // ex-tax, after discount
  tax: number;
  lineTotal: number; // gross (net + tax)
};

export type QuoteTotals = {
  lines: LineComputed[];
  subtotal: number; // Σ net (after line discounts, before tax)
  discountTotal: number; // Σ line discounts
  taxTotal: number;
  total: number; // subtotal + tax
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeLine(line: LineInput, taxMode: TaxMode): LineComputed {
  const list = round2(line.quantity * line.unitPrice);
  const taxable = round2(list - line.discount); // may be negative (adjustment lines)
  let net: number;
  let tax: number;
  if (taxMode === "inclusive") {
    net = round2(taxable / (1 + line.taxRate / 100));
    tax = round2(taxable - net);
  } else {
    net = taxable;
    tax = round2(taxable * (line.taxRate / 100));
  }
  return { ...line, net, tax, lineTotal: round2(net + tax) };
}

export function computeQuoteTotals(lines: LineInput[], taxMode: TaxMode): QuoteTotals {
  const computed = lines.map((l) => computeLine(l, taxMode));
  const subtotal = round2(computed.reduce((s, l) => s + l.net, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
  const taxTotal = round2(computed.reduce((s, l) => s + l.tax, 0));
  const total = round2(subtotal + taxTotal);
  return { lines: computed, subtotal, discountTotal, taxTotal, total };
}
