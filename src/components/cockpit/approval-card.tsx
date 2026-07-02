"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  approveInvocationAction,
  rejectInvocationAction,
  editApprovalAction,
} from "@/app/[workspace]/approvals/actions";

type ApprovalBlock = {
  approvalId: string;
  invocationId: string;
  toolName: string;
  title: string;
  summary: string;
  risk: string;
  status: string; // pending | approved | rejected | expired
  data: Record<string, unknown>;
};

const EDITABLE_KEYS = ["body", "text", "content"];

function editableField(data: Record<string, unknown>): string | null {
  for (const k of EDITABLE_KEYS) if (typeof data[k] === "string") return k;
  return null;
}

/**
 * Approval card: approve / edit / reject a sensitive proposed action. Nothing
 * has run yet — the runtime executes only on approve, and exactly once.
 */
export function ApprovalCard({ slug, block }: { slug: string; block: ApprovalBlock }) {
  const resolved = block.status && block.status !== "pending";
  const key = editableField(block.data);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(key ? String(block.data[key]) : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(resolved ? block.status : null);

  function approve() {
    setError(null);
    startTransition(async () => {
      if (key && value !== String(block.data[key])) {
        const edit = await editApprovalAction(slug, block.invocationId, { [key]: value });
        if (!edit.ok) return setError(edit.error);
      }
      const res = await approveInvocationAction(slug, block.invocationId);
      if (!res.ok) return setError(res.error ?? "Approval failed");
      setDone("approved");
    });
  }

  function reject() {
    setError(null);
    const note = window.prompt("Reason for rejecting (optional):") ?? undefined;
    startTransition(async () => {
      const res = await rejectInvocationAction(slug, block.invocationId, note);
      if (!res.ok) return setError(res.error);
      setDone("rejected");
    });
  }

  const riskVariant = block.risk === "write" ? "danger" : block.risk === "draft" ? "warning" : "outline";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 shadow-sm",
        done === "approved"
          ? "border-success/40 bg-success/5"
          : done === "rejected"
            ? "border-border bg-muted/40"
            : "border-warning/50 bg-warning/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" />
          <span className="text-sm font-semibold">{block.title}</span>
        </div>
        <Badge variant={riskVariant as "danger" | "warning" | "outline"} className="capitalize">
          {block.risk}
        </Badge>
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">{block.summary}</p>

      {key && (
        <div className="mt-2">
          {editing ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div className="rounded-md border border-border bg-card px-2.5 py-2 text-xs whitespace-pre-wrap">
              {value}
            </div>
          )}
        </div>
      )}

      {!key && (
        <dl className="mt-2 space-y-0.5">
          {Object.entries(block.data)
            .filter(([, v]) => v != null && typeof v !== "object")
            .slice(0, 6)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 text-xs">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{String(v)}</dd>
              </div>
            ))}
        </dl>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {done ? (
        <p
          className={cn(
            "mt-2.5 text-xs font-medium",
            done === "approved" ? "text-success" : "text-muted-foreground",
          )}
        >
          {done === "approved" ? "Approved — action executed." : "Rejected — nothing was done."}
        </p>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <Button size="sm" onClick={approve} disabled={pending}>
            <Check className="size-3.5" /> Approve
          </Button>
          {key && (
            <Button size="sm" variant="secondary" onClick={() => setEditing((e) => !e)} disabled={pending}>
              <Pencil className="size-3.5" /> {editing ? "Done" : "Edit"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={reject} disabled={pending}>
            <X className="size-3.5" /> Reject
          </Button>
        </div>
      )}
    </div>
  );
}
