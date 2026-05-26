"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskDialog, type TaskMember } from "@/components/tasks/task-dialog";

export function NewTaskButton({ slug, members }: { slug: string; members: TaskMember[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New task
      </Button>
      <TaskDialog slug={slug} members={members} open={open} onOpenChange={setOpen} />
    </>
  );
}
