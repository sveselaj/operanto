import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { listTasks, type TaskFilter } from "@/lib/services/tasks";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toggleTaskFromListAction } from "./actions";

export const metadata: Metadata = { title: "Tasks" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "mine", label: "Assigned to me" },
  { key: "completed", label: "Completed" },
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const ctx = await requireOrg();
  const params = await searchParams;
  const filterKey = typeof params.filter === "string" ? params.filter : "open";
  const assignee = typeof params.assignee === "string" ? params.assignee : undefined;

  const filter: TaskFilter =
    filterKey === "overdue"
      ? { overdue: true }
      : filterKey === "mine"
        ? { status: "OPEN", assignedMembershipId: ctx.membership.id }
        : filterKey === "completed"
          ? { status: "COMPLETED" }
          : { status: "OPEN" };
  if (assignee) filter.assignedMembershipId = assignee;

  const [tasks, members] = await Promise.all([
    listTasks(ctx, filter),
    listAssignableMembers(ctx),
  ]);

  return (
    <>
      <PageHeader title="Tasks" description="Follow-ups and operational work.">
        <form className="flex items-center gap-2">
          <input type="hidden" name="filter" value={filterKey} />
          <select
            name="assignee"
            defaultValue={assignee ?? ""}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Filter by assignee"
          >
            <option value="">All assignees</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.user.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            Filter
          </button>
        </form>
      </PageHeader>

      <div className="mb-4 flex gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/tasks?filter=${f.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              filterKey === f.key
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:border-ring/50",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {tasks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No tasks in this view.
          </p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <form action={toggleTaskFromListAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input
                  type="hidden"
                  name="nextStatus"
                  value={task.status === "OPEN" ? "COMPLETED" : "OPEN"}
                />
                <button
                  type="submit"
                  className="mt-0.5 h-4 w-4 rounded border border-input bg-background text-primary"
                  aria-label={task.status === "OPEN" ? "Complete task" : "Reopen task"}
                >
                  {task.status === "COMPLETED" ? "✓" : ""}
                </button>
              </form>
              <div className="min-w-0 flex-1">
                <p className={task.status === "COMPLETED" ? "text-muted-foreground line-through" : undefined}>
                  {task.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.opportunity ? (
                    <>
                      <Link
                        href={`/opportunities/${task.opportunity.id}`}
                        className="text-primary hover:underline"
                      >
                        {task.opportunity.customer?.name ?? "Opportunity"}
                      </Link>
                      {" · "}
                    </>
                  ) : null}
                  {task.assignee?.user.name ?? "Unassigned"} · {task.priority}
                </p>
              </div>
              <span
                className={
                  task.status === "OPEN" && task.dueAt && task.dueAt < new Date()
                    ? "shrink-0 text-xs text-danger"
                    : "shrink-0 text-xs text-muted-foreground"
                }
              >
                {formatDateTime(task.dueAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
