"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import type { ApprovalStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/utils";
import { approvalActionLabel, approvalStatusLabel, approvalStatusVariant } from "@/lib/labels";
import { decideApprovalAction, cancelApprovalAction } from "@/app/[workspace]/approvals/actions";

export type ApprovalView = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: ApprovalStatus;
  reason: string | null;
  decisionNote: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  createdAt: string; // ISO
  payloadSummary: string | null;
  href: string | null;
};

export function ApprovalRow({
  slug,
  approval,
  canDecide,
  canCancel,
}: {
  slug: string;
  approval: ApprovalView;
  canDecide: boolean;
  canCancel: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const pendingState = approval.status === "pending";

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideApprovalAction(slug, approval.id, decision, note || undefined);
      if (!res.ok) alert(res.error);
    });
  }
  function cancel() {
    startTransition(async () => {
      const res = await cancelApprovalAction(slug, approval.id);
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {approvalActionLabel[approval.action] ?? approval.action}
          </span>
          <Badge variant={approvalStatusVariant[approval.status]}>
            {approvalStatusLabel[approval.status]}
          </Badge>
          <span className="text-xs text-muted-foreground">{approval.entityType}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {approval.requestedBy ? `by ${approval.requestedBy} · ` : ""}
          {relativeTime(approval.createdAt)}
        </span>
      </div>

      {(approval.reason || approval.payloadSummary) && (
        <p className="mt-1 text-sm text-muted-foreground">
          {approval.payloadSummary ?? approval.reason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {approval.href && (
          <a href={approval.href} className="text-xs text-primary hover:underline">
            View {approval.entityType.toLowerCase()}
          </a>
        )}
        {pendingState && canDecide && (
          <>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="h-8 w-44"
            />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("approved")}>
              <Check className="size-3.5" /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("rejected")}>
              <X className="size-3.5" /> Reject
            </Button>
          </>
        )}
        {pendingState && !canDecide && canCancel && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>
            Cancel request
          </Button>
        )}
        {!pendingState && approval.decisionNote && (
          <span className="text-xs text-muted-foreground">“{approval.decisionNote}”</span>
        )}
      </div>
    </div>
  );
}
