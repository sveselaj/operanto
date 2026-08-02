"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAiConfigAction, type AiConfigResult } from "./actions";

const TASKS = [
  { key: "SUMMARY", label: "Summaries" },
  { key: "CLASSIFICATION", label: "Classification" },
  { key: "REPLY_DRAFT", label: "Reply drafts" },
  { key: "NEXT_ACTION", label: "Next-action recommendations" },
] as const;

export function AiConfigForm({
  config,
}: {
  config: {
    enabled: boolean;
    mode: "MOCK" | "LIVE";
    model: string;
    monthlyRequestLimit: number;
    periodRequestCount: number;
    permittedTaskTypes: string[];
  };
}) {
  const [result, formAction, pending] = useActionState<AiConfigResult, FormData>(
    updateAiConfigAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
        Enable AI assistance for this organisation
      </label>
      <label className="block">
        <span className="text-muted-foreground">Mode</span>
        <select
          name="mode"
          defaultValue={config.mode}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="MOCK">Mock (deterministic, no external calls)</option>
          <option value="LIVE">
            Live (requires deployment opt-in and provider key)
          </option>
        </select>
      </label>
      <label className="block">
        <span className="text-muted-foreground">Model</span>
        <Input name="model" defaultValue={config.model} className="mt-1" />
      </label>
      <label className="block">
        <span className="text-muted-foreground">
          Monthly request limit (used {config.periodRequestCount} this period)
        </span>
        <Input
          name="monthlyRequestLimit"
          type="number"
          min={0}
          defaultValue={config.monthlyRequestLimit}
          className="mt-1"
        />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-muted-foreground">Permitted tasks</legend>
        {TASKS.map((task) => (
          <label key={task.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              name={`task_${task.key}`}
              defaultChecked={config.permittedTaskTypes.includes(task.key)}
            />
            {task.label}
          </label>
        ))}
      </fieldset>
      {result && "error" in result ? (
        <p role="alert" className="text-xs text-danger">
          {result.error}
        </p>
      ) : null}
      {result && "ok" in result ? (
        <p className="text-xs text-success">Saved.</p>
      ) : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save AI settings"}
      </Button>
    </form>
  );
}
