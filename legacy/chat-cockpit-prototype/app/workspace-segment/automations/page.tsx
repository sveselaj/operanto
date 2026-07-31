import { Workflow } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { listAutomations } from "@/lib/services/automations";
import {
  parseConditionsSafe,
  parseActionsSafe,
} from "@/lib/automations/parse";
import { PageHeader } from "@/components/layout/page-header";
import { NewAutomationButton } from "@/components/automations/new-automation-button";
import { AutomationCard, type AutomationCardData } from "@/components/automations/automation-card";

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const canManage = can(ctx.member.role, "automations:manage");

  if (!canManage) {
    return (
      <>
        <PageHeader title="Automations" description="Trigger-and-action rules that run your playbook." />
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          Your role doesn&apos;t have access to automations.
        </div>
      </>
    );
  }

  const [automations, tags, members] = await Promise.all([
    listAutomations(ctx),
    prisma.tag.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { name: "asc" } }),
    prisma.workspaceMember.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        status: "active",
        role: { in: ["owner", "admin", "manager", "agent"] },
      },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const tagOpts = tags.map((t) => ({ id: t.id, name: t.name }));
  const memberOpts = members.map((m) => ({ id: m.userId, name: m.user.name }));

  const cards: AutomationCardData[] = automations.map((a) => ({
    id: a.id,
    name: a.name,
    trigger: a.trigger,
    enabled: a.enabled,
    conditions: parseConditionsSafe(a.conditions),
    actions: parseActionsSafe(a.actions),
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Automations"
        description="Trigger-and-action rules that run your playbook."
        action={<NewAutomationButton slug={slug} tags={tagOpts} members={memberOpts} />}
      />
      <div className="px-6 py-5">
        {cards.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-dashed border-border py-14 text-center">
            <Workflow className="mb-3 size-8 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium">No automations yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a rule to auto-tag, prioritize, assign, or follow up.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {cards.map((a) => (
              <AutomationCard
                key={a.id}
                slug={slug}
                automation={a}
                tags={tagOpts}
                members={memberOpts}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
