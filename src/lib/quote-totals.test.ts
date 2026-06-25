import { describe, it, expect } from "vitest";
import { computeLine, computeQuoteTotals, type LineInput } from "./quote-totals";

const line = (over: Partial<LineInput> = {}): LineInput => ({
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  taxRate: 0,
  ...over,
});

describe("computeLine", () => {
  it("tax-exclusive: tax is added on top of net", () => {
    const r = computeLine(line({ quantity: 2, unitPrice: 100, taxRate: 20 }), "exclusive");
    expect(r.net).toBe(200);
    expect(r.tax).toBe(40);
    expect(r.lineTotal).toBe(240);
  });

  it("applies an absolute line discount before tax", () => {
    const r = computeLine(line({ quantity: 1, unitPrice: 200, discount: 50, taxRate: 20 }), "exclusive");
    expect(r.net).toBe(150);
    expect(r.tax).toBe(30);
    expect(r.lineTotal).toBe(180);
  });

  it("tax-inclusive: tax is extracted from the gross price", () => {
    const r = computeLine(line({ quantity: 1, unitPrice: 120, taxRate: 20 }), "inclusive");
    expect(r.net).toBe(100);
    expect(r.tax).toBe(20);
    expect(r.lineTotal).toBe(120);
  });

  it("supports negative (adjustment/discount) lines", () => {
    const r = computeLine(line({ quantity: 1, unitPrice: -30, taxRate: 0 }), "exclusive");
    expect(r.net).toBe(-30);
    expect(r.lineTotal).toBe(-30);
  });
});

describe("computeQuoteTotals", () => {
  it("sums net, tax and total across lines", () => {
    const t = computeQuoteTotals(
      [line({ quantity: 2, unitPrice: 100, taxRate: 20 }), line({ quantity: 1, unitPrice: 50, taxRate: 0 })],
      "exclusive",
    );
    expect(t.subtotal).toBe(250);
    expect(t.taxTotal).toBe(40);
    expect(t.total).toBe(290);
  });

  it("a negative adjustment line reduces the total", () => {
    const t = computeQuoteTotals(
      [line({ quantity: 1, unitPrice: 200, taxRate: 0 }), line({ description: "rule", unitPrice: -20, taxRate: 0 } as Partial<LineInput>)],
      "exclusive",
    );
    expect(t.total).toBe(180);
  });

  it("tracks discountTotal separately", () => {
    const t = computeQuoteTotals([line({ unitPrice: 100, discount: 10, taxRate: 0 })], "exclusive");
    expect(t.discountTotal).toBe(10);
    expect(t.subtotal).toBe(90);
  });
});
