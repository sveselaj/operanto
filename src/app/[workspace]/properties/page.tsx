import { notFound, redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { getVertical } from "@/lib/verticals/registry";
import { listProperties } from "@/verticals/real-estate/service";

function money(v: number, currency = "EUR") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "default"> = {
  available: "success",
  reserved: "warning",
  under_offer: "warning",
  sold: "danger",
  off_market: "default",
};

export default async function PropertiesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  // This screen only exists for the real-estate vertical.
  if (!getVertical(ctx.workspace.vertical)) notFound();
  if (!can(ctx.member.role, "properties:read")) redirect(`/${slug}/command`);

  const properties = await listProperties(ctx);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Properties"
        description="The Pronatona property catalogue — the source of truth for availability, price and status."
      />
      <div className="px-6 py-4">
        {properties.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No properties yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {properties.map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{p.code}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[p.district, p.city].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[p.status] ?? "default"} className="capitalize">
                    {p.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-sm">{p.title}</div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold">{money(p.price, p.currency)}</span>
                  {p.areaSqm && <span className="text-xs text-muted-foreground">{p.areaSqm} m²</span>}
                  {typeof p.bedrooms === "number" && (
                    <span className="text-xs text-muted-foreground">{p.bedrooms} bd</span>
                  )}
                  <Badge variant="outline" className="capitalize">{p.type}</Badge>
                  <Badge variant="outline" className="capitalize">{p.listingType}</Badge>
                </div>
                {p.assignedAgent?.name && (
                  <div className="mt-2 text-xs text-muted-foreground">Agent: {p.assignedAgent.name}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
