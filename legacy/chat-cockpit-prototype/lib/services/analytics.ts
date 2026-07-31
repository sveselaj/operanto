import "server-only";
import type { Intent, Sentiment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { runAITask } from "@/lib/ai/service";
import { managerInsightsTask } from "@/lib/ai/tasks";
import { intentLabel, sentimentLabel } from "@/lib/labels";

export type Overview = {
  openConversations: number;
  resolvedConversations: number;
  leads: number;
  openTasks: number;
  overdueTasks: number;
  avgFirstResponseMinutes: number | null;
};

export async function getOverview(ctx: WorkspaceContext): Promise<Overview> {
  requirePermission(ctx.member.role, "reports:view");
  const wId = ctx.workspace.id;
  const now = new Date();

  const [openConversations, resolvedConversations, leads, openTasks, overdueTasks] =
    await Promise.all([
      prisma.conversation.count({ where: { workspaceId: wId, status: { in: ["open", "pending"] } } }),
      prisma.conversation.count({ where: { workspaceId: wId, status: "resolved" } }),
      prisma.conversation.count({
        where: { workspaceId: wId, OR: [{ intent: "qualified_lead" }, { leadScore: { gte: 70 } }] },
      }),
      prisma.task.count({ where: { workspaceId: wId, status: { in: ["todo", "in_progress"] } } }),
      prisma.task.count({
        where: { workspaceId: wId, status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } },
      }),
    ]);

  return {
    openConversations,
    resolvedConversations,
    leads,
    openTasks,
    overdueTasks,
    avgFirstResponseMinutes: await avgFirstResponse(ctx),
  };
}

/** Average minutes between the first inbound message and the first outbound reply. */
async function avgFirstResponse(ctx: WorkspaceContext): Promise<number | null> {
  const convs = await prisma.conversation.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: {
      messages: {
        select: { direction: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
    take: 200,
  });

  const deltas: number[] = [];
  for (const c of convs) {
    const firstInbound = c.messages.find((m) => m.direction === "inbound");
    if (!firstInbound) continue;
    const firstReply = c.messages.find(
      (m) => m.direction === "outbound" && m.createdAt > firstInbound.createdAt,
    );
    if (!firstReply) continue;
    deltas.push((firstReply.createdAt.getTime() - firstInbound.createdAt.getTime()) / 60000);
  }
  if (deltas.length === 0) return null;
  return Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
}

export async function getIntentBreakdown(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "reports:view");
  const grouped = await prisma.conversation.groupBy({
    by: ["intent"],
    where: { workspaceId: ctx.workspace.id, intent: { not: null } },
    _count: { _all: true },
  });
  return grouped
    .map((g) => ({
      intent: g.intent as Intent,
      label: intentLabel[g.intent as Intent],
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getSentimentBreakdown(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "reports:view");
  const grouped = await prisma.conversation.groupBy({
    by: ["sentiment"],
    where: { workspaceId: ctx.workspace.id, sentiment: { not: null } },
    _count: { _all: true },
  });
  return grouped
    .map((g) => ({
      sentiment: g.sentiment as Sentiment,
      label: sentimentLabel[g.sentiment as Sentiment],
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Inbound vs outbound message volume per day for the last `days` days. */
export async function getVolumeTrend(ctx: WorkspaceContext, days = 14) {
  requirePermission(ctx.member.role, "reports:view");
  const since = new Date(Date.now() - days * 86_400_000);
  const messages = await prisma.message.findMany({
    where: { workspaceId: ctx.workspace.id, createdAt: { gte: since }, direction: { not: "internal" } },
    select: { direction: true, createdAt: true },
  });

  const buckets = new Map<string, { inbound: number; outbound: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
    buckets.set(d.toISOString().slice(0, 10), { inbound: 0, outbound: 0 });
  }
  for (const m of messages) {
    const key = m.createdAt.toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    if (m.direction === "inbound") b.inbound++;
    else b.outbound++;
  }
  return [...buckets.entries()].map(([date, v]) => ({
    date: date.slice(5), // MM-DD
    ...v,
  }));
}

export async function getAgentWorkload(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "reports:view");
  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      status: "active",
      role: { in: ["owner", "admin", "manager", "agent"] },
    },
    include: { user: true },
  });

  return Promise.all(
    members.map(async (m) => {
      const [openConversations, openTasks] = await Promise.all([
        prisma.conversation.count({
          where: {
            workspaceId: ctx.workspace.id,
            assignedToUserId: m.userId,
            status: { in: ["open", "pending"] },
          },
        }),
        prisma.task.count({
          where: {
            workspaceId: ctx.workspace.id,
            assignedToUserId: m.userId,
            status: { in: ["todo", "in_progress"] },
          },
        }),
      ]);
      return { userId: m.userId, name: m.user.name, role: m.role, openConversations, openTasks };
    }),
  );
}

/** Run the manager-insights AI task over current metrics and persist Insight rows. */
export async function generateManagerInsights(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "ai:run");

  const [overview, intents, sentiment, workload] = await Promise.all([
    getOverview(ctx),
    getIntentBreakdown(ctx),
    getSentimentBreakdown(ctx),
    getAgentWorkload(ctx),
  ]);

  const stats = [
    `Open conversations: ${overview.openConversations}`,
    `Resolved conversations: ${overview.resolvedConversations}`,
    `Leads detected: ${overview.leads}`,
    `Open tasks: ${overview.openTasks} (overdue: ${overview.overdueTasks})`,
    `Avg first response: ${overview.avgFirstResponseMinutes ?? "n/a"} minutes`,
    `Top intents: ${intents.slice(0, 5).map((i) => `${i.label} (${i.count})`).join(", ") || "none"}`,
    `Sentiment: ${sentiment.map((s) => `${s.label} (${s.count})`).join(", ") || "none"}`,
    `Agent workload: ${workload.map((w) => `${w.name} ${w.openConversations} convs / ${w.openTasks} tasks`).join("; ")}`,
  ].join("\n");

  const { data } = await runAITask(ctx, managerInsightsTask, { stats });

  // Replace previously auto-generated open insights to avoid pile-up.
  await prisma.insight.deleteMany({
    where: { workspaceId: ctx.workspace.id, status: "open", sourceData: { path: ["generated"], equals: true } },
  });

  await prisma.insight.createMany({
    data: data.insights.map((i) => ({
      workspaceId: ctx.workspace.id,
      type: i.type as never,
      title: i.title,
      description: i.description,
      priority: i.priority as never,
      status: "open" as const,
      sourceData: { generated: true },
    })),
  });

  await audit(ctx, {
    action: "insights.generate",
    entity: "Insight",
    after: { count: data.insights.length },
  });

  return data.insights;
}
