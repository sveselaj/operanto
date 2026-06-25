import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { getQuote } from "@/lib/services/quotes";
import { listSellableProducts } from "@/lib/services/catalogue";
import { pendingApproval } from "@/lib/services/approvals";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { QuoteBuilder } from "@/components/opportunities/quote-builder";

const num = (d: { toString(): string } | number | null | undefined) =>
  d == null ? 0 : Number(d.toString());

export default async function QuotePage({
  params,
}: {
  params: Promise<{ workspace: string; id: string; quoteId: string }>;
}) {
  const { workspace: slug, id, quoteId } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "quotes:manage")) notFound();

  const quote = await getQuote(ctx, quoteId);
  if (!quote || quote.opportunityId !== id) notFound();

  const products = await listSellableProducts(ctx);
  const canEdit = can(ctx.member.role, "quotes:manage");
  const pendingSend = !!(await pendingApproval(ctx, "Quote", quote.id, "quote.send"));

  return (
    <>
      <PageHeader
        title={`Quote ${quote.number ?? `#${quote.id.slice(-6)}`}`}
        description={quote.opportunity?.customer?.name ?? undefined}
      />
      <div className="space-y-4 px-6 py-5">
        <Link
          href={`/${slug}/opportunities/${id}`}
          className="text-xs text-primary hover:underline"
        >
          ← Back to opportunity
        </Link>
        <Card>
          <CardContent className="pt-5">
            <QuoteBuilder
              slug={slug}
              opportunityId={id}
              quoteId={quote.id}
              canEdit={canEdit}
              pendingSend={pendingSend}
              quote={{
                status: quote.status,
                currency: quote.currency,
                taxMode: quote.taxMode,
                subtotal: num(quote.subtotal),
                discountTotal: num(quote.discountTotal),
                taxTotal: num(quote.taxTotal),
                total: num(quote.total),
                notes: quote.notes,
                validUntil: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
              }}
              lines={quote.lines.map((l) => ({
                id: l.id,
                description: l.description,
                quantity: num(l.quantity),
                unitPrice: num(l.unitPrice),
                discount: num(l.discount),
                taxRate: l.taxRate,
                lineTotal: num(l.lineTotal),
              }))}
              products={products.map((p) => ({
                id: p.id,
                name: p.name,
                unitPrice: num(p.unitPrice),
                taxRate: p.taxRate,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
