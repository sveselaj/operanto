"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageRow, type ThreadMessage } from "@/components/cockpit/assistant-thread";
import { CockpitBlocks } from "@/components/cockpit/cards";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Block = any;

/**
 * Streaming cockpit chat. Renders committed messages, then drives a turn over
 * the NDJSON `stream` route: the user echo, tool/approval cards as they land,
 * and the reply text progressively — committing both persisted messages on
 * `done`. No polling, no full refresh on the happy path.
 */
export function AssistantChat({
  slug,
  threadId,
  initialMessages,
  suggestions = [],
  intro,
}: {
  slug: string;
  threadId: string;
  initialMessages: ThreadMessage[];
  suggestions?: string[];
  intro?: React.ReactNode;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [pendingUser, setPendingUser] = useState<ThreadMessage | null>(null);
  const [liveText, setLiveText] = useState("");
  const [liveBlocks, setLiveBlocks] = useState<Block[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, liveText, liveBlocks, pendingUser]);

  async function submit(text: string) {
    const body = text.trim();
    if (!body || streaming) return;
    setValue("");
    setError(null);
    setStreaming(true);
    setLiveText("");
    setLiveBlocks([]);
    setPendingUser({
      id: "pending",
      role: "user",
      content: body,
      structuredContent: null,
      confidence: null,
      createdAt: new Date().toISOString(),
      authorName: null,
    });

    let sawDone = false;
    try {
      const res = await fetch(`/${slug}/assistant/${threadId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Local accumulators so we can commit atomically on `done`.
      let userMsg: ThreadMessage | null = null;
      const blocks: Block[] = [];
      let doneMsg: ThreadMessage | null = null;

      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "user") {
            userMsg = ev.message;
            setPendingUser(ev.message);
          } else if (ev.type === "block") {
            blocks.push(ev.block);
            setLiveBlocks([...blocks]);
          } else if (ev.type === "text") {
            setLiveText((t) => t + ev.delta);
          } else if (ev.type === "done") {
            doneMsg = ev.message;
            sawDone = true;
          }
        }
      }

      if (sawDone && doneMsg) {
        setMessages((prev) => [...prev, ...(userMsg ? [userMsg] : []), doneMsg as ThreadMessage]);
        setPendingUser(null);
        setLiveText("");
        setLiveBlocks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStreaming(false);
      if (!sawDone) {
        // Abnormal end — reconcile with the server (source of truth).
        setPendingUser(null);
        setLiveText("");
        setLiveBlocks([]);
        router.refresh();
      }
    }
  }

  const showLive = streaming && (liveText || liveBlocks.length > 0);

  return (
    <>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-background px-4 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {intro}
          {messages.map((m) => (
            <MessageRow key={m.id} slug={slug} message={m} />
          ))}
          {pendingUser && <MessageRow slug={slug} message={pendingUser} />}
          {(showLive || (streaming && !showLive)) && (
            <div className="flex justify-start gap-2.5">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Sparkles className="size-3.5" />
              </div>
              <div className="min-w-0 max-w-[85%]">
                {liveText ? (
                  <div className="whitespace-pre-wrap rounded-2xl border border-border bg-card px-3.5 py-2 text-sm">
                    {liveText}
                    <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-muted-foreground align-middle" />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground">
                    Working…
                  </div>
                )}
                {liveBlocks.length > 0 && <CockpitBlocks blocks={liveBlocks} slug={slug} />}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-card px-4 py-3">
        {suggestions.length > 0 && messages.length === 0 && !streaming && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
          className="mx-auto max-w-3xl"
        >
          <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            <Sparkles className="mb-1.5 ml-1 size-4 shrink-0 text-primary" />
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit(value);
                }
              }}
              rows={1}
              placeholder="Ask Operanto…  (⌘↵ to send)"
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
              disabled={streaming}
            />
            <button
              type="submit"
              disabled={streaming || !value.trim()}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40",
              )}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        </form>
      </div>
    </>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
