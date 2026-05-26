"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Priority } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  createTaskAction,
  updateTaskAction,
} from "@/app/[workspace]/tasks/actions";

export type TaskMember = { id: string; name: string };

export type EditableTask = {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  assignedToUserId: string | null;
  dueAt: string | null; // ISO
};

function dateValue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function TaskDialog({
  slug,
  members,
  open,
  onOpenChange,
  task,
  prefill,
}: {
  slug: string;
  members: TaskMember[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task?: EditableTask;
  prefill?: { title?: string; linkedConversationId?: string; linkedCustomerId?: string };
}) {
  const router = useRouter();
  const editing = !!task;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(task?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "normal");
  const [assignee, setAssignee] = useState(task?.assignedToUserId ?? "");
  const [due, setDue] = useState(dateValue(task?.dueAt ?? null));

  function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = editing
        ? await updateTaskAction(slug, task!.id, {
            title,
            description,
            priority,
            assignedToUserId: assignee || null,
            dueAt: due || null,
          })
        : await createTaskAction(slug, {
            title,
            description,
            priority,
            assignedToUserId: assignee || null,
            dueAt: due || null,
            linkedConversationId: prefill?.linkedConversationId ?? null,
            linkedCustomerId: prefill?.linkedCustomerId ?? null,
          });
      if (res.ok) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update this task." : "Create a task for your team."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Priority</Label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <Label>Assignee</Label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Due date</Label>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
