"use client";

import { useState, useTransition } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runDiagnosticAction } from "@/app/[workspace]/settings/actions";

/**
 * MediaSync diagnostics — test-send through a channel connector and show the
 * result. Mirrors MediaSyncHub's per-channel delivery check.
 */
export function DiagnosticsRunner({
  slug,
  channels,
}: {
  slug: string;
  channels: { id: string; name: string; type: string }[];
}) {
  const [channelAccountId, setChannelAccountId] = useState(channels[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("Operanto test message ✅");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const res = await runDiagnosticAction(slug, channelAccountId, to, body);
      if (res.ok) {
        setResult({
          ok: res.result.ok,
          text: res.result.ok
            ? `Sent${res.result.externalMessageId ? ` (id: ${res.result.externalMessageId})` : ""}.`
            : (res.result.error ?? "Test-send failed."),
        });
      } else {
        setResult({ ok: false, text: res.error });
      }
    });
  }

  if (channels.length === 0) {
    return <p className="text-sm text-muted-foreground">No channels connected yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <label className="text-xs font-medium text-muted-foreground">
          Channel
          <select
            value={channelAccountId}
            onChange={(e) => setChannelAccountId(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          To (phone / handle / email)
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+38349123456"
            className="mt-1"
          />
        </label>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={submit} disabled={pending || !channelAccountId || !to.trim()}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {pending ? "Sending…" : "Test-send"}
        </Button>
        {result && (
          <span className={result.ok ? "text-xs text-success" : "text-xs text-danger"}>
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
