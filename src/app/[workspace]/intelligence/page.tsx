import { Inbox, CheckCircle2, Flame, AlarmClock, Clock } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  getOverview,
  getIntentBreakdown,
  getSentimentBreakdown,
  getVolumeTrend,
  getAgentWorkload,
} from "@/lib/services/analytics";
import { priorityLabel, priorityVariant } from "@/lib/labels";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  IntentBarChart,
  SentimentDonut,
  VolumeTrendChart,
} from "@/components/intelligence/charts";
import { GenerateInsightsButton } from "@/components/intelligence/generate-insights-button";

export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const canGenerate = can(ctx.member.role, "ai:run");

  const [overview, intents, sentiment, trend, workload, insights] = await Promise.all([
    getOverview(ctx),
    getIntentBreakdown(ctx),
    getSentimentBreakdown(ctx),
    getVolumeTrend(ctx),
    getAgentWorkload(ctx),
    prisma.insight.findMany({
      where: { workspaceId: ctx.workspace.id, status: "open" },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);

  const responseLabel =
    overview.avgFirstResponseMinutes == null
      ? "—"
      : overview.avgFirstResponseMinutes < 60
        ? `${overview.avgFirstResponseMinutes}m`
        : `${(overview.avgFirstResponseMinutes / 60).toFixed(1)}h`;

  const metrics = [
    { label: "Open conversations", value: overview.openConversations, icon: Inbox },
    { label: "Resolved", value: overview.resolvedConversations, icon: CheckCircle2 },
    { label: "Leads detected", value: overview.leads, icon: Flame },
    { label: "Avg first response", value: responseLabel, icon: Clock },
    { label: "Overdue tasks", value: overview.overdueTasks, icon: AlarmClock },
  ];

  return (
    <>
      <PageHeader
        title="Intelligence"
        description="Analytics and AI-generated insights."
        action={canGenerate ? <GenerateInsightsButton slug={slug} /> : undefined}
      />
      <div className="space-y-6 px-6 py-5">
        {/* Metric cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <Card key={m.label}>
                <CardContent className="flex items-center gap-3 p-4 pt-4">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold leading-none">{m.value}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top intents</CardTitle>
            </CardHeader>
            <CardContent>
              <IntentBarChart data={intents} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sentiment mix</CardTitle>
            </CardHeader>
            <CardContent>
              <SentimentDonut data={sentiment} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message volume (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <VolumeTrendChart data={trend} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Agent workload */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent workload</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {workload.map((w) => (
                <div key={w.userId} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <Avatar name={w.name} className="size-7 text-[11px]" />
                  <span className="flex-1 truncate text-sm">{w.name}</span>
                  <Badge variant="outline">{w.openConversations} convs</Badge>
                  <Badge variant="default">{w.openTasks} tasks</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* AI insights */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {insights.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No insights yet. {canGenerate && "Click “Generate insights”."}
                </p>
              )}
              {insights.map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{i.title}</span>
                    <Badge variant={priorityVariant[i.priority]}>{priorityLabel[i.priority]}</Badge>
                  </div>
                  {i.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{i.description}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
