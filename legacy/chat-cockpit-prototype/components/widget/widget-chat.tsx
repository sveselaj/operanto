"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";

type Msg = { from: "customer" | "system"; body: string };

export function WidgetChat({
  channelAccountId,
  brandName,
}: {
  channelAccountId: string;
  brandName: string;
}) {
  const [name, setName] = useState("");
  const [started, setStarted] = useState(false);
  const [externalId] = useState(() => `web_${Math.random().toString(36).slice(2, 10)}`);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setMessages((m) => [...m, { from: "customer", body: text }]);
    setBody("");
    try {
      const res = await fetch("/api/webhooks/webchat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelAccountId,
          customer: { name: name || "Website visitor", externalId },
          body: text,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to send");
      setMessages((m) => [
        ...m,
        { from: "system", body: "Thanks! A team member will reply shortly." },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[600px] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      <div className="flex items-center gap-2 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
        <Sparkles className="size-4" />
        <span className="text-sm font-semibold">{brandName}</span>
        <span className="ml-auto text-xs opacity-80">Live chat</span>
      </div>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">Hi! What&apos;s your name?</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => setStarted(true)}
            className="h-9 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Start chat
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            <div className="text-center text-xs text-muted-foreground">
              You&apos;re chatting as {name || "Website visitor"}.
            </div>
            {messages.map((m, i) => (
              <div key={i} className={m.from === "customer" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm " +
                    (m.from === "customer"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground")
                  }
                >
                  {m.body}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}
          <div className="flex items-center gap-2 border-t border-border p-3">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type a message…"
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={send}
              disabled={sending || !body.trim()}
              className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
