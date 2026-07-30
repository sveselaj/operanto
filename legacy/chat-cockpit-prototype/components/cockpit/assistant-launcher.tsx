"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { createThreadAction, sendMessageAction } from "@/app/[workspace]/assistant/actions";

/** First-run launcher: creates a thread and sends the opening message in one go. */
export function AssistantLauncher({
  slug,
  suggestions,
}: {
  slug: string;
  suggestions: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start(text: string) {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const created = await createThreadAction(slug);
      if (!created.ok) return setError(created.error);
      const sent = await sendMessageAction(slug, created.id, body);
      if (!sent.ok) return setError(sent.error);
      router.push(`/${slug}/assistant/${created.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Sparkles className="size-6" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Operanto assistant</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Ask about your contacts, conversations, opportunities and properties. Sensitive actions are
        prepared for your approval — never sent automatically.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(value);
        }}
        className="mt-6"
      >
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 text-left focus-within:ring-2 focus-within:ring-ring">
          <Sparkles className="mb-1.5 ml-1 size-4 shrink-0 text-primary" />
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                start(value);
              }
            }}
            rows={1}
            placeholder="What would you like to do?  (⌘↵ to send)"
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending || !value.trim()}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {pending && <p className="mt-2 text-xs text-muted-foreground">Starting…</p>}

      <div className="mt-6 flex flex-wrap justify-center gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => start(s)}
            disabled={pending}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
