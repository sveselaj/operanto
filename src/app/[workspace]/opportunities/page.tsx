import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/layout/page-header";
import { listOpportunities, OPPORTUNITY_STAGES } from "@/lib/services/crm";

function money(v: number | null, currency = "EUR") {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export default async function OpportunitiesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "opportunities:read")) redirect(`/${slug}/command`);

  const opps = await listOpportunities(ctx);
  const byStage = OPPORTUNITY_STAGES.map((stage) => ({
    stage,
    items: opps.filter((o) => o.stage === stage),
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Opportunities"
        description="Your CRM pipeline. Leads and deals the assistant and team create appear here."
      />
      <div className="flex-1 overflow-x-auto">
        <div className="flex h-full min-w-max gap-3 px-6 py-4">
          {byStage.map(({ stage, items }) => (
            <div key={stage} className="flex w-72 shrink-0 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{STAGE_LABEL[stage]}</span>
                <Badge variant="outline">{items.length}</Badge>
              </div>
              <div className="space-y-2 overflow-y-auto">
                {items.map((o) => {
                  const req = o.requirements as { budgetMax?: number; locations?: string[]; timeline?: string } | null;
                  return (
                    <div key={o.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{o.title}</span>
                        {typeof o.leadScore === "number" && o.leadScore >= 70 && (
                          <Badge variant="warning">{o.leadScore}</Badge>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold">{money(o.value, o.currency)}</div>
                      {req && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {[
                            req.budgetMax ? `≤ ${money(req.budgetMax, o.currency)}` : null,
                            req.locations?.length ? req.locations.join(", ") : null,
                            req.timeline,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{o.contact?.name ?? "No contact"}</span>
                        {o.owner?.name && <Avatar name={o.owner.name} className="size-5 text-[10px]" />}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">
                    Empty
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
