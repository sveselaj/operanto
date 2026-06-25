import { notFound } from "next/navigation";
import Link from "next/link";
import type { OpportunityStatus } from "@prisma/client";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { listOpportunities, opportunityStatusCounts } from "@/lib/services/opportunities";
import { requirementProgress } from "@/lib/opportunity-progress";
import { opportunityStatusLabel, opportunityStatusVariant } from "@/lib/labels";
import { relativeTime, cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const TABS: { value: OpportunityStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "abandoned", label: "Abandoned" },
];

function money(value: { toString(): string } | null, currency: string): string | null {
  if (value == null) return null;
  const n = Number(value.toString());
  if (Number.isNaN(n)) return null;
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(n);
}

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "opportunities:manage")) notFound();

  const sp = await searchParams;
  const statusParam = typeof sp.status === "string" ? sp.status : "all";
  const status = (TABS.some((t) => t.value === statusParam) ? statusParam : "all") as
    | OpportunityStatus
    | "all";

  const [opportunities, counts] = await Promise.all([
    listOpportunities(ctx, { status }),
    opportunityStatusCounts(ctx),
  ]);

  return (
    <>
      <PageHeader title="Opportunities" description="Leads and deals — the commercial spine." />
      <div className="px-6 py-5">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const active = t.value === status;
            return (
              <Link
                key={t.value}
                href={`/${slug}/opportunities${t.value === "all" ? "" : `?status=${t.value}`}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
                {counts[t.value] ? <span className="ml-1.5 opacity-70">{counts[t.value]}</span> : null}
              </Link>
            );
          })}
        </div>

        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No opportunities yet. Promote a conversation from the Inbox to create one.
          </p>
        ) : (
          <div className="space-y-2">
            {opportunities.map((o) => {
              const progress = requirementProgress(o.requirements);
              const value = money(o.value, o.currency);
              return (
                <Link
                  key={o.id}
                  href={`/${slug}/opportunities/${o.id}`}
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
                >
                  <Avatar name={o.customer?.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {o.title ?? o.customer?.name ?? "Opportunity"}
                      </span>
                      <Badge variant={opportunityStatusVariant[o.status]}>
                        {opportunityStatusLabel[o.status]}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {o.customer?.name ?? "Unknown"} · updated {relativeTime(o.updatedAt)}
                    </p>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    {progress.requiredTotal > 0 && (
                      <div className={progress.complete ? "text-success" : ""}>
                        {progress.requiredProvided}/{progress.requiredTotal} required facts
                      </div>
                    )}
                    {o.assignedTo && <div>{o.assignedTo.name}</div>}
                  </div>
                  {value && <div className="text-sm font-semibold tabular-nums">{value}</div>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
