"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowUp } from "lucide-react";
import { createThreadAction, sendMessageAction } from "@/app/[workspace]/assistant/actions";

const SUGGESTIONS = [
  "Find leads not contacted in 7 days",
  "Summarize today's new inquiries",
  "Draft a reply for the latest pricing question",
];

/**
 * Persistent bottom command bar. Routes a natural-language command into a new
 * assistant thread (plan → tools → grounded reply). Rendered as an inert prompt
 * for roles without `assistant:use`.
 */
export function CommandBar({ slug, canUse }: { slug: string; canUse: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || pending) return;
    if (!canUse) {
      setError("Your role can't use the assistant.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const created = await createThreadAction(slug);
      if (!created.ok) return setError(created.error);
      const sent = await sendMessageAction(slug, created.id, text);
      if (!sent.ok) return setError(sent.error);
      setValue("");
      router.push(`/${slug}/assistant/${created.id}`);
      router.refresh();
    });
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
              if (error) setError(null);
            }}
            placeholder="Ask Operanto to do something…"
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={!value.trim() || pending}
            className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {pending && <p className="mt-2 text-xs text-muted-foreground">Starting a chat…</p>}
      </div>
    </div>
  );
}
