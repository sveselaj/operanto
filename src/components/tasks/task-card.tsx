"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Pencil } from "lucide-react";
import type { Priority, TaskStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { priorityLabel, priorityVariant } from "@/lib/labels";
import { TaskDialog, type TaskMember, type EditableTask } from "@/components/tasks/task-dialog";
import { updateTaskAction } from "@/app/[workspace]/tasks/actions";

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

export type TaskCardData = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  assignedToUserId: string | null;
  assigneeName: string | null;
  linkedConversationId: string | null;
  linkedCustomerName: string | null;
};

export function TaskCard({
  slug,
  task,
  members,
}: {
  slug: string;
  task: TaskCardData;
  members: TaskMember[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const overdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== "done";

  function changeStatus(status: TaskStatus) {
    startTransition(async () => {
      const res = await updateTaskAction(slug, task.id, { status });
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        <button
          onClick={() => setEditOpen(true)}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
          title="Edit"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={priorityVariant[task.priority]}>{priorityLabel[task.priority]}</Badge>
        {task.dueAt && (
          <span className={overdue ? "text-xs font-medium text-danger" : "text-xs text-muted-foreground"}>
            {overdue ? "Overdue · " : "Due "}
            {new Date(task.dueAt).toLocaleDateString()}
          </span>
        )}
        {task.linkedConversationId && (
          <Link
            href={`/${slug}/inbox/${task.linkedConversationId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <MessageSquare className="size-3" />
            {task.linkedCustomerName ?? "conversation"}
          </Link>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <select
          value={task.status}
          disabled={pending}
          onChange={(e) => changeStatus(e.target.value as TaskStatus)}
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {task.assigneeName ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar name={task.assigneeName} className="size-5 text-[10px]" />
            {task.assigneeName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
      </div>

      <TaskDialog
        slug={slug}
        members={members}
        open={editOpen}
        onOpenChange={setEditOpen}
        task={{
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          assignedToUserId: task.assignedToUserId,
          dueAt: task.dueAt,
        }}
      />
    </div>
  );
}
