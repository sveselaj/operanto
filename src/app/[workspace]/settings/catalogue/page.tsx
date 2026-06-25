import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { listProducts, listBusinessRules } from "@/lib/services/catalogue";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductManager } from "@/components/settings/product-manager";
import { BusinessRuleManager } from "@/components/settings/business-rule-manager";

export default async function CataloguePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "catalog:manage")) notFound();

  const [products, rules] = await Promise.all([listProducts(ctx), listBusinessRules(ctx)]);

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Products, services and business rules — the vertical's offering and pricing policy."
      />
      <div className="space-y-5 px-6 py-5">
        <Link href={`/${slug}/settings`} className="text-xs text-primary hover:underline">
          ← Back to settings
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Products & services</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductManager
              slug={slug}
              products={products}
              currency={ctx.workspace.defaultCurrency}
              defaultTaxRate={ctx.workspace.defaultTaxRate}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business rules</CardTitle>
          </CardHeader>
          <CardContent>
            <BusinessRuleManager slug={slug} rules={rules} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
