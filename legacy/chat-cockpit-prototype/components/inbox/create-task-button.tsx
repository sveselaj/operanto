"use client";

import { useState } from "react";
import { CheckSquare } from "lucide-react";
import { TaskDialog, type TaskMember } from "@/components/tasks/task-dialog";

export function CreateTaskButton({
  slug,
  conversationId,
  customerId,
  customerName,
  members,
}: {
  slug: string;
  conversationId: string;
  customerId: string | null;
  customerName: string | null;
  members: TaskMember[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <CheckSquare className="size-3.5" />
        Create task from this conversation
      </button>
      <TaskDialog
        slug={slug}
        members={members}
        open={open}
        onOpenChange={setOpen}
        prefill={{
          title: customerName ? `Follow up with ${customerName}` : "Follow up",
          linkedConversationId: conversationId,
          linkedCustomerId: customerId ?? undefined,
        }}
      />
    </>
  );
}
