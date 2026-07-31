"use client";

import { useTransition } from "react";
import type { ConversationStatus, Priority } from "@prisma/client";
import {
  updateStatusAction,
  updatePriorityAction,
  assignConversationAction,
  type ActionResult,
} from "@/app/[workspace]/inbox/actions";

const STATUS_OPTIONS: { value: ConversationStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "waiting_customer", label: "Waiting on customer" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function Select({
  value,
  disabled,
  onChange,
  children,
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
    >
      {children}
    </select>
  );
}

export function ConversationControls({
  slug,
  conversationId,
  status,
  priority,
  assigneeId,
  members,
  canTriage,
}: {
  slug: string;
  conversationId: string;
  status: ConversationStatus;
  priority: Priority;
  assigneeId: string | null;
  members: { id: string; name: string }[];
  canTriage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={status}
        disabled={!canTriage || pending}
        onChange={(v) => run(() => updateStatusAction(slug, conversationId, v as ConversationStatus))}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      <Select
        value={priority}
        disabled={!canTriage || pending}
        onChange={(v) => run(() => updatePriorityAction(slug, conversationId, v as Priority))}
      >
        {PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} priority
          </option>
        ))}
      </Select>

      <Select
        value={assigneeId ?? ""}
        disabled={!canTriage || pending}
        onChange={(v) => run(() => assignConversationAction(slug, conversationId, v || null))}
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
