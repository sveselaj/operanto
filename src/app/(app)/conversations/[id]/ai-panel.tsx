"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  applyDraftAction,
  createSuggestedTaskAction,
  decideDraftAction,
  editDraftAction,
  runAiTaskAction,
  type AiPanelResult,
} from "./actions";

/**
 * AI assistance panel — every output is advisory; every consequential action
 * is an explicit human decision handled by a permission-gated server action.
 */

export type AiResultView = {
  id: string;
  taskType: "SUMMARY" | "CLASSIFICATION" | "REPLY_DRAFT" | "NEXT_ACTION";
  status: string;
  provider: string;
  model: string;
  confidence: number | null;
  riskLevel: string | null;
  createdAt: string;
  output: Record<string, unknown> | null;
  requestedByName: string | null;
};

export type ApprovalView = {
  id: string;
  status: string;
  riskLevel: string;
  lowConfidence: boolean;
  reply: string;
  edited: boolean;
  executionClaimed: boolean;
};

function ErrorLine({ result }: { result: AiPanelResult }) {
  if (result && "error" in result) {
    return (
      <p role="alert" className="text-xs text-danger">
        {result.error}
      </p>
    );
  }
  return null;
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const low = confidence < 0.5;
  const high = confidence >= 0.8;
  return (
    <span
      className={
        low
          ? "rounded-full border border-warning px-2 py-0.5 text-[11px] text-warning"
          : "rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
      }
    >
      {low ? "Low confidence" : high ? "High confidence" : "Confidence"}{" "}
      {(confidence * 100).toFixed(0)}%
    </span>
  );
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  const cls =
    risk === "BLOCKED"
      ? "border-danger text-danger"
      : risk === "HIGH"
        ? "border-danger/60 text-danger"
        : risk === "MEDIUM"
          ? "border-warning text-warning"
          : "border-border text-muted-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      Risk: {risk}
    </span>
  );
}

function Provenance({ result }: { result: AiResultView }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {result.provider} · {result.model} ·{" "}
      {new Date(result.createdAt).toLocaleString("en-GB")}
      {result.requestedByName ? ` · requested by ${result.requestedByName}` : null}
    </p>
  );
}

function RequestButton({
  conversationId,
  taskType,
  label,
  disabled,
}: {
  conversationId: string;
  taskType: AiResultView["taskType"];
  label: string;
  disabled: boolean;
}) {
  const [result, formAction, pending] = useActionState<AiPanelResult, FormData>(
    runAiTaskAction,
    null,
  );
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="taskType" value={taskType} />
      <Button type="submit" size="sm" variant="outline" disabled={disabled || pending}>
        {pending ? "Working…" : label}
      </Button>
      <ErrorLine result={result} />
    </form>
  );
}

function DraftReview({
  conversationId,
  approval,
  blockedNote,
}: {
  conversationId: string;
  approval: ApprovalView;
  blockedNote: boolean;
}) {
  const [editResult, editAction, editPending] = useActionState<AiPanelResult, FormData>(
    editDraftAction,
    null,
  );
  const [decideResult, decideAction, decidePending] = useActionState<
    AiPanelResult,
    FormData
  >(decideDraftAction, null);
  const [applyResult, applyAction, applyPending] = useActionState<
    AiPanelResult,
    FormData
  >(applyDraftAction, null);

  if (approval.status === "PENDING") {
    return (
      <div className="space-y-2">
        {blockedNote ? (
          <p className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
            This draft is classified BLOCKED and can never be approved.
          </p>
        ) : null}
        <form action={editAction} className="space-y-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="approvalId" value={approval.id} />
          <Textarea
            name="reply"
            rows={4}
            defaultValue={approval.reply}
            aria-label="Draft reply"
          />
          <Button type="submit" size="sm" variant="outline" disabled={editPending}>
            {editPending ? "Saving…" : "Save edit"}
          </Button>
          <ErrorLine result={editResult} />
        </form>
        <form action={decideAction} className="space-y-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="approvalId" value={approval.id} />
          {approval.lowConfidence ? (
            <label className="flex items-center gap-2 text-xs text-warning">
              <input type="checkbox" name="acknowledgeLowConfidence" />
              I acknowledge this is a low-confidence draft and I have reviewed it
              carefully.
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              name="decision"
              value="APPROVED"
              disabled={decidePending || blockedNote}
            >
              Approve
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              name="decision"
              value="REJECTED"
              disabled={decidePending}
            >
              Reject
            </Button>
          </div>
          <ErrorLine result={decideResult} />
        </form>
      </div>
    );
  }

  if (approval.status === "APPROVED" && !approval.executionClaimed) {
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-sm">
          {approval.reply}
        </p>
        <div className="flex items-center gap-2">
          <form action={applyAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="approvalId" value={approval.id} />
            <Button type="submit" size="sm" disabled={applyPending}>
              {applyPending ? "Recording…" : "Record as manual message"}
            </Button>
          </form>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard?.writeText(approval.reply)}
          >
            Copy to composer
          </Button>
        </div>
        <ErrorLine result={applyResult} />
      </div>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Draft {approval.status.toLowerCase()}
      {approval.executionClaimed ? " · recorded as a manual message" : ""}.
    </p>
  );
}

export function AiPanel({
  conversationId,
  aiEnabled,
  aiMode,
  budgetWarning,
  restricted,
  canConfigure,
  results,
  approval,
  suggestedTaskTitle,
}: {
  conversationId: string;
  aiEnabled: boolean;
  aiMode: "MOCK" | "LIVE";
  budgetWarning: string | null;
  restricted: boolean;
  canConfigure: boolean;
  results: AiResultView[];
  approval: ApprovalView | null;
  suggestedTaskTitle: string | null;
}) {
  const [taskResult, taskAction, taskPending] = useActionState<AiPanelResult, FormData>(
    createSuggestedTaskAction,
    null,
  );

  const latest = (taskType: AiResultView["taskType"]) =>
    results.find((r) => r.taskType === taskType && r.status !== "SUPERSEDED") ?? null;
  const summary = latest("SUMMARY");
  const classification = latest("CLASSIFICATION");
  const draft = latest("REPLY_DRAFT");
  const nextAction = latest("NEXT_ACTION");

  if (!aiEnabled) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">AI assistance</h2>
        <p className="text-sm text-muted-foreground">
          AI assistance is not enabled for this organisation.
          {canConfigure ? " Enable it under Settings → Organisation." : ""}
        </p>
      </section>
    );
  }

  const disabled = restricted;

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">AI assistance</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {aiMode === "MOCK" ? "Mock mode" : "Live mode"}
        </span>
      </div>
      <div className="space-y-4 px-4 py-4">
        {budgetWarning ? (
          <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
            {budgetWarning}
          </p>
        ) : null}
        {restricted ? (
          <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
            Processing for this customer is restricted — AI assistance is blocked.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <RequestButton
            conversationId={conversationId}
            taskType="SUMMARY"
            label="Summarise"
            disabled={disabled}
          />
          <RequestButton
            conversationId={conversationId}
            taskType="CLASSIFICATION"
            label="Classify"
            disabled={disabled}
          />
          <RequestButton
            conversationId={conversationId}
            taskType="REPLY_DRAFT"
            label={draft ? "Regenerate draft" : "Draft reply"}
            disabled={disabled}
          />
          <RequestButton
            conversationId={conversationId}
            taskType="NEXT_ACTION"
            label="Recommend action"
            disabled={disabled}
          />
        </div>

        {summary?.output ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Summary
              </h3>
              <ConfidenceBadge confidence={summary.confidence} />
            </div>
            <p className="text-sm">{String(summary.output.summary ?? "")}</p>
            {Array.isArray(summary.output.unresolvedItems) &&
            summary.output.unresolvedItems.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Unresolved: {(summary.output.unresolvedItems as string[]).join("; ")}
              </p>
            ) : null}
            <Provenance result={summary} />
          </div>
        ) : null}

        {classification?.output ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Classification
              </h3>
              <ConfidenceBadge confidence={classification.confidence} />
              <RiskBadge risk={classification.riskLevel} />
            </div>
            <p className="text-sm">
              {String(classification.output.primaryIntent ?? "")} ·{" "}
              {String(classification.output.sentiment ?? "")} · urgency{" "}
              {String(classification.output.urgency ?? "")}
            </p>
            <p className="text-xs text-muted-foreground">
              {String(classification.output.rationale ?? "")}
            </p>
            <Provenance result={classification} />
          </div>
        ) : null}

        {nextAction?.output ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recommended next action
              </h3>
              <ConfidenceBadge confidence={nextAction.confidence} />
            </div>
            <p className="text-sm">
              {String(nextAction.output.action ?? "")} —{" "}
              {String(nextAction.output.rationale ?? "")}
            </p>
            <Provenance result={nextAction} />
          </div>
        ) : null}

        {suggestedTaskTitle ? (
          <form action={taskAction} className="space-y-1">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="title" value={suggestedTaskTitle} />
            <Button type="submit" size="sm" variant="outline" disabled={taskPending}>
              {taskPending ? "Creating…" : `Create follow-up task: ${suggestedTaskTitle}`}
            </Button>
            <ErrorLine result={taskResult} />
          </form>
        ) : null}

        {draft?.output ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Draft reply
              </h3>
              <ConfidenceBadge confidence={draft.confidence} />
              <RiskBadge risk={draft.riskLevel} />
              {draft.riskLevel === "HIGH" ? (
                <span className="text-[11px] text-danger">
                  High-risk topic — review with extra care.
                </span>
              ) : null}
            </div>
            {Array.isArray(draft.output.assumptions) &&
            draft.output.assumptions.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Assumptions: {(draft.output.assumptions as string[]).join("; ")}
              </p>
            ) : null}
            {Array.isArray(draft.output.missingInformation) &&
            draft.output.missingInformation.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Missing information:{" "}
                {(draft.output.missingInformation as string[]).join("; ")}
              </p>
            ) : null}
            <Provenance result={draft} />
            {approval ? (
              <DraftReview
                conversationId={conversationId}
                approval={approval}
                blockedNote={approval.riskLevel === "BLOCKED"}
              />
            ) : null}
          </div>
        ) : draft && draft.status === "FAILED" ? (
          <p className="text-xs text-danger">
            The last draft attempt failed ({draft.status}). Manual handling is
            unaffected.
          </p>
        ) : null}
      </div>
    </section>
  );
}
