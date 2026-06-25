"use client";

import { useState, useTransition } from "react";
import type { OpportunityStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import {
  updateOpportunityAction,
  assignOpportunityAction,
  type ActionResult,
} from "@/app/[workspace]/opportunities/actions";

const STATUS: { value: OpportunityStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "abandoned", label: "Abandoned" },
];

export function OpportunityControls({
  slug,
  id,
  status,
  value,
  currency,
  assigneeId,
  members,
  canEdit,
}: {
  slug: string;
  id: string;
  status: OpportunityStatus;
  value: string | null; // formatted decimal string from the server
  currency: string;
  assigneeId: string | null;
  members: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [val, setVal] = useState(value ?? "");

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) alert(res.error);
    });
  }

  function saveValue() {
    const trimmed = val.trim();
    const num = trimmed === "" ? null : Number(trimmed);
    if (num !== null && Number.isNaN(num)) return;
    run(() => updateOpportunityAction(slug, id, { value: num }));
  }

  const selectCls =
    "h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={status}
        disabled={!canEdit || pending}
        onChange={(e) => run(() => updateOpportunityAction(slug, id, { status: e.target.value as OpportunityStatus }))}
        className={selectCls}
      >
        {STATUS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">{currency}</span>
        <Input
          value={val}
          disabled={!canEdit || pending}
          onChange={(e) => setVal(e.target.value)}
          onBlur={saveValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveValue();
          }}
          placeholder="Value"
          inputMode="decimal"
          className="h-8 w-28"
        />
      </div>

      <select
        value={assigneeId ?? ""}
        disabled={!canEdit || pending}
        onChange={(e) => run(() => assignOpportunityAction(slug, id, e.target.value || null))}
        className={selectCls}
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
