import Link from "next/link";
import {
  Inbox,
  Flame,
  CheckSquare,
  AlarmClock,
  ArrowRight,
  Lightbulb,
} from "lucide-react";
import { requireWorkspace, scope } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { relativeTime } from "@/lib/utils";
import {
  statusLabel,
  statusVariant,
  priorityLabel,
  priorityVariant,
  intentLabel,
  channelLabel,
  taskStatusLabel,
  taskStatusVariant,
} from "@/lib/labels";
import { can } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { InsightCreatePost } from "@/components/intelligence/insight-create-post";

export default async function CommandPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const where = scope(ctx);
  const now = new Date();
  const canManageContent = can(ctx.member.role, "content:manage");

  const [
    openConversations,
    leadCount,
    openTasks,
    overdueTasks,
    priorityConversations,
    tasks,
    insights,
  ] = await Promise.all([
    prisma.conversation.count({ where: { ...where, status: { in: ["open", "pending"] } } }),
    prisma.conversation.count({
      where: { ...where, OR: [{ intent: "qualified_lead" }, { leadScore: { gte: 70 } }] },
    }),
    prisma.task.count({ where: { ...where, status: { in: ["todo", "in_progress"] } } }),
    prisma.task.count({
      where: { ...where, status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } },
    }),
    prisma.conversation.findMany({
      where: { ...where, status: { in: ["open", "pending"] } },
      include: { customer: true, assignedTo: true },
      orderBy: [{ priority: "desc" }, { lastMessageAt: "desc" }],
      take: 6,
    }),
    prisma.task.findMany({
      where: { ...where, status: { in: ["todo", "in_progress"] } },
      include: { assignedTo: true },
      orderBy: [{ dueAt: "asc" }],
      take: 6,
    }),
    prisma.insight.findMany({
      where: { ...where, status: "open" },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
  ]);

  const stats = [
    { label: "Open conversations", value: openConversations, icon: Inbox },
    { label: "Leads detected", value: leadCount, icon: Flame },
    { label: "Open tasks", value: openTasks, icon: CheckSquare },
    { label: "Overdue tasks", value: overdueTasks, icon: AlarmClock },
  ];

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Command center</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What needs your attention in {ctx.workspace.name}.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-3 p-4 pt-4">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-4" />
                </div>
                <div>
                  <div className="text-2xl font-semibold leading-none">{s.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Priority conversations */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Priority conversations</CardTitle>
            <Link
              href={`/${slug}/inbox`}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open inbox <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {priorityConversations.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No open conversations.
              </p>
            )}
            {priorityConversations.map((c) => (
              <Link
                key={c.id}
                href={`/${slug}/inbox/${c.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"
              >
                <Avatar name={c.customer?.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.customer?.name ?? "Unknown customer"}
                    </span>
                    <Badge variant="default">{channelLabel[c.channelType]}</Badge>
                    {c.intent && (
                      <span className="truncate text-xs text-muted-foreground">
                        {intentLabel[c.intent]}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.summary ?? c.subject ?? "—"}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    {typeof c.leadScore === "number" && c.leadScore >= 70 && (
                      <Badge variant="warning">Lead {c.leadScore}</Badge>
                    )}
                    <Badge variant={priorityVariant[c.priority]}>
                      {priorityLabel[c.priority]}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {relativeTime(c.lastMessageAt)}
                  </span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Insights */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Insights</CardTitle>
            <Lightbulb className="size-4 text-warning" />
          </CardHeader>
          <CardContent className="space-y-3">
            {insights.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No insights yet.</p>
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
                {canManageContent && i.type === "content_opportunity" && (
                  <InsightCreatePost slug={slug} insightId={i.id} />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Open tasks */}
      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Open tasks</CardTitle>
          <Link
            href={`/${slug}/tasks`}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            All tasks <ArrowRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {tasks.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No open tasks.</p>
          )}
          {tasks.map((t) => {
            const overdue = t.dueAt && t.dueAt < now;
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted"
              >
                <Badge variant={taskStatusVariant[t.status]}>{taskStatusLabel[t.status]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                {t.assignedTo && (
                  <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    <Avatar name={t.assignedTo.name} className="size-5 text-[10px]" />
                    {t.assignedTo.name}
                  </span>
                )}
                {t.dueAt && (
                  <span
                    className={
                      overdue ? "text-xs font-medium text-danger" : "text-xs text-muted-foreground"
                    }
                  >
                    {overdue ? "Overdue · " : "Due "}
                    {t.dueAt.toLocaleDateString()}
                  </span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
