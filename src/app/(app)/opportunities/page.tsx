import type { Metadata } from "next";
import Link from "next/link";
import type { OpportunityStage } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import {
  listOpportunities,
  OPPORTUNITY_STAGES,
} from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatStage } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({
  searchParams,
}: PageProps<"/opportunities">) {
  const ctx = await requireOrg();
  const params = await searchParams;
  const stageParam = typeof params.stage === "string" ? params.stage : undefined;
  const stage = OPPORTUNITY_STAGES.includes(stageParam as OpportunityStage)
    ? (stageParam as OpportunityStage)
    : undefined;
  const unassigned = params.unassigned === "1";

  const opportunities = await listOpportunities(ctx, { stage, unassigned });

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Inquiries and deals projected from your source systems and managed here."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href="/opportunities"
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            !stage && !unassigned
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:border-ring/50",
          )}
        >
          All
        </Link>
        {OPPORTUNITY_STAGES.map((s) => (
          <Link
            key={s}
            href={`/opportunities?stage=${s}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              stage === s
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:border-ring/50",
            )}
          >
            {formatStage(s)}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Summary</th>
              <th className="px-4 py-2.5 font-medium">Property</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
              <th className="px-4 py-2.5 font-medium">Assignee</th>
              <th className="px-4 py-2.5 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No opportunities match this view.
                </td>
              </tr>
            ) : (
              opportunities.map((opp) => (
                <tr key={opp.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/opportunities/${opp.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {opp.customer.name ?? opp.customer.email ?? "Unknown"}
                    </Link>
                  </td>
                  <td className="max-w-56 truncate px-4 py-2.5">{opp.summary ?? opp.type}</td>
                  <td className="px-4 py-2.5">
                    {opp.properties[0]?.propertyContext.referenceCode ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline">{formatStage(opp.stage)}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {opp.assignee?.user.name ?? (
                      <span className="text-warning">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatDateTime(opp.lastActivityAt ?? opp.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
