"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OUTCOME_RULES } from "@operanto/crm-calloutcome";
import {
  recordOutcomeAction,
  startCallAction,
  type OutcomeState,
  type StartCallState,
} from "../../queue/actions";

/**
 * Call workspace: start the call, then record its outcome. The follow-up
 * invariant is enforced server-side; this form only *shows* which follow-ups
 * an outcome allows (from the same engine table), so the agent is guided
 * rather than corrected.
 */
export function CallWorkspace({
  leadId,
  leadName,
  callable,
  blockedReason,
}: {
  leadId: string;
  leadName: string;
  callable: boolean;
  blockedReason?: string;
}) {
  const [call, startAction, starting] = useActionState<StartCallState | null, FormData>(
    startCallAction,
    null,
  );
  const [outcome, outcomeAction, saving] = useActionState<OutcomeState | null, FormData>(
    recordOutcomeAction,
    null,
  );
  const [selectedOutcome, setSelectedOutcome] = useState<string>("");

  const rule = selectedOutcome
    ? OUTCOME_RULES[selectedOutcome as keyof typeof OUTCOME_RULES]
    : undefined;
  const allowedKinds = rule?.allowedNextKinds ?? [];
  const needsTime = ["RETRY", "CALLBACK"].some((k) => allowedKinds.includes(k as never));

  if (!callable) {
    return (
      <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        {blockedReason ?? "Calling is not available for this lead."}
      </p>
    );
  }

  if (outcome?.savedNextLeadId !== undefined) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-success">Outcome saved.</p>
        {outcome.savedNextLeadId ? (
          <Button asChild size="sm" variant="outline">
            <a href={`/crm/leads/${outcome.savedNextLeadId}`}>Next lead in the queue</a>
          </Button>
        ) : (
          <p className="text-muted-foreground">Queue is empty — nothing else is due.</p>
        )}
      </div>
    );
  }

  if (!call?.attemptId) {
    return (
      <form action={startAction} className="space-y-2">
        <input type="hidden" name="leadId" value={leadId} />
        <Button type="submit" size="sm" disabled={starting}>
          {starting ? "Starting…" : `Call ${leadName}`}
        </Button>
        {call?.error ? (
          <p role="alert" className="text-xs text-danger">
            {call.error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border px-3 py-2 text-sm">
        <p className="font-medium">Calling {call.displayNumber}</p>
        {call.href ? (
          <a href={call.href} className="text-xs underline">
            Open in the phone app
          </a>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Record the outcome when the call ends — every call needs one.
        </p>
      </div>

      <form action={outcomeAction} className="space-y-2">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="attemptId" value={call.attemptId} />
        <div className="space-y-1.5">
          <Label htmlFor="outcome">Outcome</Label>
          <select
            id="outcome"
            name="outcome"
            required
            value={selectedOutcome}
            onChange={(event) => setSelectedOutcome(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="" disabled>
              How did it go?
            </option>
            {Object.keys(OUTCOME_RULES).map((key) => (
              <option key={key} value={key}>
                {key.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        {selectedOutcome ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="nextActionKind">Follow-up</Label>
              <select
                id="nextActionKind"
                name="nextActionKind"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                defaultValue={allowedKinds[0]}
              >
                {allowedKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            {needsTime ? (
              <div className="space-y-1.5">
                <Label htmlFor="nextActionAt">When</Label>
                <Input id="nextActionAt" name="nextActionAt" type="datetime-local" />
              </div>
            ) : null}
            {rule?.requiresReason || allowedKinds.includes("NONE" as never) ? (
              <Input
                name="reason"
                placeholder={rule?.requiresReason ? "Reason (required)" : "Reason (if no follow-up)"}
                maxLength={500}
              />
            ) : null}
            <Input name="note" placeholder="Note (optional)" maxLength={1000} />
            <Input
              name="durationSeconds"
              type="number"
              min={0}
              placeholder="Duration in seconds (optional)"
            />
          </>
        ) : null}

        <Button type="submit" size="sm" disabled={saving || !selectedOutcome}>
          {saving ? "Saving…" : "Save outcome and go to next"}
        </Button>
        {outcome?.error ? (
          <p role="alert" className="text-xs text-danger">
            {outcome.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
