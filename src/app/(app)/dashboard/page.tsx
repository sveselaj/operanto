import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { getDashboard } from "@/lib/services/dashboard";
import { PageHeader } from "@/components/app/page-header";
import { ActorBadge } from "@/components/app/actor-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatStage } from "@/lib/format";
import { OPPORTUNITY_STAGES } from "@/lib/services/opportunities";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number | string;
  href: string;
  tone?: "danger" | "warning";
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-ring/40">
        <CardContent className="pt-5">
          <p
            className={
              tone === "danger"
                ? "text-2xl font-semibold text-danger"
                : tone === "warning"
                  ? "text-2xl font-semibold text-warning"
                  : "text-2xl font-semibold"
            }
          >
            {value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const data = await getDashboard(ctx);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Operational overview for ${ctx.organisation.name}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="New opportunities (7 days)" value={data.newOpportunities} href="/opportunities?stage=NEW" />
        {data.isManager ? (
          <Stat
            label="Unassigned opportunities"
            value={data.unassignedOpportunities}
            href="/opportunities?unassigned=1"
            tone={data.unassignedOpportunities > 0 ? "warning" : undefined}
          />
        ) : null}
        <Stat
          label="Follow-ups due"
          value={data.followUpsDue}
          href="/tasks?filter=overdue"
          tone={data.followUpsDue > 0 ? "warning" : undefined}
        />
        {data.isManager ? (
          <Stat
            label="Failed integration events"
            value={data.failedEvents}
            href="/integrations/pronatona"
            tone={data.failedEvents > 0 ? "danger" : undefined}
          />
        ) : null}
      </div>

      {data.integration ? (
        <Card className="mt-4">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-5 text-sm">
            <span className="font-medium">Pronatona integration</span>
            <span
              className={
                data.integration.status === "ACTIVE"
                  ? "text-success"
                  : "text-danger"
              }
            >
              {data.integration.status}
            </span>
            <span className="text-muted-foreground">
              Last event: {formatDateTime(data.integration.lastReceivedAt)}
            </span>
            <span className="text-muted-foreground">
              Last processed: {formatDateTime(data.integration.lastSuccessfulAt)}
            </span>
            <Link href="/integrations/pronatona" className="ml-auto text-primary hover:underline">
              Health details
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {data.isManager ? "Open opportunities" : "My opportunities"}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {data.myOpportunities.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nothing open right now.</p>
            ) : (
              data.myOpportunities.map((opp) => (
                <Link
                  key={opp.id}
                  href={`/opportunities/${opp.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary"
                >
                  <span className="min-w-0 truncate">
                    {opp.customer.name ?? "Unknown customer"} — {opp.summary ?? opp.type}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatStage(opp.stage)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">My open tasks</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {data.myOpenTasks.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No open tasks assigned to you.</p>
            ) : (
              data.myOpenTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {task.title}
                    {task.opportunity ? (
                      <>
                        {" · "}
                        <Link
                          href={`/opportunities/${task.opportunity.id}`}
                          className="text-primary hover:underline"
                        >
                          {task.opportunity.customer?.name ?? "opportunity"}
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <span
                    className={
                      task.dueAt && task.dueAt < new Date()
                        ? "shrink-0 text-xs text-danger"
                        : "shrink-0 text-xs text-muted-foreground"
                    }
                  >
                    {formatDateTime(task.dueAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Opportunities by stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {OPPORTUNITY_STAGES.map((stage) => {
              const count = data.stageCounts[stage] ?? 0;
              if (count === 0) return null;
              return (
                <Link
                  key={stage}
                  href={`/opportunities?stage=${stage}`}
                  className="flex items-center justify-between py-1 text-sm hover:text-primary"
                >
                  <span>{formatStage(stage)}</span>
                  <span className="font-medium">{count}</span>
                </Link>
              );
            })}
            {Object.keys(data.stageCounts).length === 0 ? (
              <p className="text-sm text-muted-foreground">No opportunities yet.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent customer activity</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {data.recentActivity.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              data.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-2 py-2.5 text-sm">
                  <ActorBadge actorType={activity.actorType} />
                  <span className="min-w-0 flex-1 truncate">
                    {activity.opportunity ? (
                      <Link
                        href={`/opportunities/${activity.opportunity.id}`}
                        className="hover:text-primary"
                      >
                        {activity.summary}
                      </Link>
                    ) : (
                      activity.summary
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(activity.occurredAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
