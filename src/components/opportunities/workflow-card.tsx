"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, ChevronRight, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  startWorkflowAction,
  advanceWorkflowAction,
} from "@/app/[workspace]/opportunities/workflow-actions";

export type WorkflowCardData = {
  status: string;
  definitionName: string;
  steps: { key: string; name: string; done: boolean; current: boolean }[];
  currentStepName: string | null;
  missingLabels: string[];
  canAdvance: boolean;
  isLastStep: boolean;
  actions: { type: string; label: string }[];
};

export function WorkflowCard({
  slug,
  opportunityId,
  workflow,
  canManage,
}: {
  slug: string;
  opportunityId: string;
  workflow: WorkflowCardData | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const res = await startWorkflowAction(slug, opportunityId);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }
  function advance() {
    startTransition(async () => {
      const res = await advanceWorkflowAction(slug, opportunityId);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  if (!workflow) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">No workflow started.</p>
        {canManage && (
          <Button size="sm" variant="outline" onClick={start} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
            Start workflow
          </Button>
        )}
      </div>
    );
  }

  const completed = workflow.status === "completed";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{workflow.definitionName}</span>
        {completed && <Badge variant="success">Completed</Badge>}
      </div>

      {/* Step progress */}
      <ol className="space-y-1.5">
        {workflow.steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span className={s.done ? "text-success" : s.current ? "text-primary" : "text-muted-foreground"}>
              {s.done ? <Check className="size-4" /> : <Circle className={cn("size-4", s.current && "fill-primary/20")} />}
            </span>
            <span className={cn(s.current && "font-medium", !s.done && !s.current && "text-muted-foreground")}>
              {s.name}
            </span>
          </li>
        ))}
      </ol>

      {!completed && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Current step</div>
          <div className="text-sm font-medium">{workflow.currentStepName}</div>

          {workflow.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {workflow.actions.map((a) => (
                <Badge key={a.type} variant="outline">{a.label}</Badge>
              ))}
            </div>
          )}

          {workflow.missingLabels.length > 0 ? (
            <p className="mt-2 text-xs text-warning">
              Blocked — still need: {workflow.missingLabels.join(", ")}
            </p>
          ) : (
            <p className="mt-2 text-xs text-success">All requirements for this step are met.</p>
          )}

          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={pending || !workflow.canAdvance}
              onClick={advance}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" />}
              {workflow.isLastStep ? "Complete workflow" : "Advance step"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
