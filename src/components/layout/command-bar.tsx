"use client";

import { useState } from "react";
import { Sparkles, ArrowUp } from "lucide-react";

const SUGGESTIONS = [
  "Show unanswered Instagram leads today",
  "Draft replies for pricing questions",
  "Summarize this conversation",
  "Create an SOP for refund requests",
];

export function CommandBar() {
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    // AI command routing lands in Phase 3 (AI service layer).
    setNote(`Command captured: “${value.trim()}”. AI routing arrives in Phase 3.`);
    setValue("");
  }

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setValue(s)}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-ring"
        >
          <Sparkles className="size-4 shrink-0 text-primary" />
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (note) setNote(null);
            }}
            placeholder="Ask Operanto to do something…"
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}
