"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { QuoteStatus, TaxMode } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { quoteStatusLabel, quoteStatusVariant } from "@/lib/labels";
import {
  addLineAction,
  updateLineAction,
  removeLineAction,
  updateQuoteAction,
  requestQuoteSendAction,
  requestPriceOverrideAction,
  type ActionResult,
} from "@/app/[workspace]/opportunities/quote-actions";

export type BuilderLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
};
export type BuilderQuote = {
  status: QuoteStatus;
  currency: string;
  taxMode: TaxMode;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  validUntil: string | null; // yyyy-mm-dd
};
export type BuilderProduct = { id: string; name: string; unitPrice: number; taxRate: number };

// "sent" is excluded — sending goes through the approval gate (Send button).
const STATUSES: QuoteStatus[] = ["draft", "reviewed", "approved", "accepted", "declined", "expired"];

export function QuoteBuilder({
  slug,
  opportunityId,
  quoteId,
  quote,
  lines,
  products,
  canEdit,
  pendingSend,
}: {
  slug: string;
  opportunityId: string;
  quoteId: string;
  quote: BuilderQuote;
  lines: BuilderLine[];
  products: BuilderProduct[];
  canEdit: boolean;
  pendingSend: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [discLabel, setDiscLabel] = useState("Discount");
  const [discAmount, setDiscAmount] = useState("");
  const [discReason, setDiscReason] = useState("");

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function addProductLine() {
    const p = products.find((x) => x.id === productId);
    run(() =>
      addLineAction(slug, opportunityId, quoteId, {
        productId: p?.id ?? null,
        description: p?.name ?? "New item",
        quantity: 1,
        unitPrice: p?.unitPrice ?? 0,
        taxRate: p?.taxRate ?? 0,
      }),
    );
  }

  const cur = quote.currency;
  const inputCls = "h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={quoteStatusVariant[quote.status]}>{quoteStatusLabel[quote.status]}</Badge>
        {canEdit && (
          <>
            <select
              value={quote.status}
              disabled={pending}
              onChange={(e) => run(() => updateQuoteAction(slug, opportunityId, quoteId, { status: e.target.value as QuoteStatus }))}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{quoteStatusLabel[s]}</option>
              ))}
            </select>
            <select
              value={quote.taxMode}
              disabled={pending}
              onChange={(e) => run(() => updateQuoteAction(slug, opportunityId, quoteId, { taxMode: e.target.value as TaxMode }))}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="exclusive">Tax exclusive</option>
              <option value="inclusive">Tax inclusive</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Valid until
              <Input
                type="date"
                defaultValue={quote.validUntil ?? ""}
                disabled={pending}
                onBlur={(e) => run(() => updateQuoteAction(slug, opportunityId, quoteId, { validUntil: e.target.value || null }))}
                className="h-8 w-40"
              />
            </label>
          </>
        )}
      </div>

      {/* Lines */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 text-right font-medium">Unit price</th>
              <th className="px-2 py-2 text-right font-medium">Discount</th>
              <th className="px-2 py-2 text-right font-medium">Tax %</th>
              <th className="px-2 py-2 text-right font-medium">Total</th>
              {canEdit && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="px-3 py-4 text-center text-muted-foreground">
                  No lines yet.
                </td>
              </tr>
            )}
            {lines.map((l) => {
              const upd = (patch: Parameters<typeof updateLineAction>[4]) =>
                run(() => updateLineAction(slug, opportunityId, quoteId, l.id, patch));
              return (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <input
                      defaultValue={l.description}
                      disabled={!canEdit || pending}
                      onBlur={(e) => e.target.value !== l.description && upd({ description: e.target.value })}
                      className="h-8 w-full min-w-40 rounded-md border border-transparent bg-transparent px-2 text-sm focus:border-border focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input defaultValue={l.quantity} disabled={!canEdit || pending} inputMode="decimal"
                      onBlur={(e) => Number(e.target.value) !== l.quantity && upd({ quantity: Number(e.target.value) })} className={inputCls} />
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input defaultValue={l.unitPrice} disabled={!canEdit || pending} inputMode="decimal"
                      onBlur={(e) => Number(e.target.value) !== l.unitPrice && upd({ unitPrice: Number(e.target.value) })} className={inputCls} />
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input defaultValue={l.discount} disabled={!canEdit || pending} inputMode="decimal"
                      onBlur={(e) => Number(e.target.value) !== l.discount && upd({ discount: Number(e.target.value) })} className={inputCls} />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input defaultValue={l.taxRate} disabled={!canEdit || pending} inputMode="decimal"
                      onBlur={(e) => Number(e.target.value) !== l.taxRate && upd({ taxRate: Number(e.target.value) })} className={inputCls} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatMoney(l.lineTotal, cur)}</td>
                  {canEdit && (
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => run(() => removeLineAction(slug, opportunityId, quoteId, l.id))} className="text-muted-foreground hover:text-danger" title="Remove">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add line */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">Custom line</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.unitPrice, cur)}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={addProductLine} disabled={pending}>
            <Plus className="size-3.5" /> Add line
          </Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      )}

      {/* Totals */}
      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <Row label="Subtotal" value={formatMoney(quote.subtotal, cur)} />
        {quote.discountTotal !== 0 && <Row label="Discounts" value={`−${formatMoney(quote.discountTotal, cur)}`} />}
        <Row label="Tax" value={formatMoney(quote.taxTotal, cur)} />
        <div className="flex items-center justify-between border-t border-border pt-1.5 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(quote.total, cur)}</span>
        </div>
      </div>

      {/* Send + approvals */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {quote.status === "sent" ? (
            <span className="text-sm text-success">Sent to customer ✓</span>
          ) : pendingSend ? (
            <span className="text-sm text-warning">Send pending approval…</span>
          ) : (
            <Button
              size="sm"
              disabled={pending || lines.length === 0}
              onClick={() =>
                startTransition(async () => {
                  const res = await requestQuoteSendAction(slug, opportunityId, quoteId);
                  if (!res.ok) setError(res.error);
                  else {
                    if (!res.sent) alert("Approval requested — a manager must approve before this is sent.");
                    router.refresh();
                  }
                })
              }
            >
              Send to customer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowDiscount((s) => !s)} disabled={pending}>
            Request discount
          </Button>
        </div>
      )}

      {showDiscount && canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <label className="text-xs font-medium text-muted-foreground">
            Label
            <Input value={discLabel} onChange={(e) => setDiscLabel(e.target.value)} className="mt-1 h-8 w-40" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Amount (negative = discount)
            <Input value={discAmount} inputMode="decimal" onChange={(e) => setDiscAmount(e.target.value)} placeholder="-20" className="mt-1 h-8 w-32" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Reason
            <Input value={discReason} onChange={(e) => setDiscReason(e.target.value)} className="mt-1 h-8 w-48" />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || discAmount === ""}
            onClick={() =>
              startTransition(async () => {
                const res = await requestPriceOverrideAction(slug, opportunityId, quoteId, {
                  label: discLabel || "Discount",
                  amount: Number(discAmount),
                  reason: discReason || null,
                });
                if (!res.ok) setError(res.error);
                else {
                  setShowDiscount(false);
                  setDiscAmount("");
                  setDiscReason("");
                  alert("Discount approval requested.");
                  router.refresh();
                }
              })
            }
          >
            Request approval
          </Button>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Notes</label>
        <textarea
          defaultValue={quote.notes ?? ""}
          disabled={!canEdit || pending}
          onBlur={(e) => (e.target.value !== (quote.notes ?? "")) && run(() => updateQuoteAction(slug, opportunityId, quoteId, { notes: e.target.value || null }))}
          rows={2}
          className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
