import type { TaskStatus } from "@prisma/client";
import { requireWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { listTasks } from "@/lib/services/tasks";
import { PageHeader } from "@/components/layout/page-header";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskCard, type TaskCardData } from "@/components/tasks/task-card";
import { AssigneeFilter } from "@/components/tasks/assignee-filter";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: slug } = await params;
  const sp = await searchParams;
  const assignee = (Array.isArray(sp.assignee) ? sp.assignee[0] : sp.assignee) ?? "all";

  const ctx = await requireWorkspace(slug);
  const [allTasks, members] = await Promise.all([
    listTasks(ctx, { assignee: assignee as "me" | "all" }),
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

  const memberOpts = members.map((m) => ({ id: m.userId, name: m.user.name }));

  const cards: TaskCardData[] = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt?.toISOString() ?? null,
    assignedToUserId: t.assignedToUserId,
    assigneeName: t.assignedTo?.name ?? null,
    linkedConversationId: t.linkedConversationId,
    linkedCustomerName: t.linkedConversation?.customer?.name ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work created from conversations and operations."
        action={
          <div className="flex items-center gap-2">
            <AssigneeFilter value={assignee} />
            <NewTaskButton slug={slug} members={memberOpts} />
          </div>
        }
      />
      <div className="grid h-[calc(100%-73px)] grid-cols-1 gap-3 overflow-x-auto p-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colTasks = cards.filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="flex min-w-0 flex-col rounded-xl bg-muted/40">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-medium">{col.label}</span>
                <span className="text-xs text-muted-foreground">{colTasks.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
                {colTasks.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">No tasks</p>
                )}
                {colTasks.map((t) => (
                  <TaskCard key={t.id} slug={slug} task={t} members={memberOpts} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
