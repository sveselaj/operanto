"use client";

import { useState, useTransition } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sendReplyAction, aiDraftReplyAction } from "@/app/[workspace]/inbox/actions";

export function ReplyComposer({
  slug,
  conversationId,
  canReply,
}: {
  slug: string;
  conversationId: string;
  canReply: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafting, setDrafting] = useState(false);
  const [draftMeta, setDraftMeta] = useState<
    { risk: string; confidence: number; followUp: string | null } | null
  >(null);

  if (!canReply) {
    return (
      <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
        Your role can read this conversation but not send replies.
      </div>
    );
  }

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await sendReplyAction(slug, conversationId, body);
      if (res.ok) {
        setBody("");
        setDraftMeta(null);
      } else setError(res.error);
    });
  }

  async function generateDraft() {
    setError(null);
    setDrafting(true);
    const res = await aiDraftReplyAction(slug, conversationId);
    setDrafting(false);
    if (res.ok) {
      setBody(res.draft.reply);
      setDraftMeta({
        risk: res.draft.risk,
        confidence: res.draft.confidence,
        followUp: res.draft.recommendedFollowUp,
      });
    } else {
      setError(res.error);
    }
  }

  const riskVariant =
    draftMeta?.risk === "high" ? "danger" : draftMeta?.risk === "medium" ? "warning" : "success";

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      {draftMeta && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>AI draft — review before sending.</span>
          <Badge variant={riskVariant}>risk: {draftMeta.risk}</Badge>
          <Badge variant="outline">confidence {Math.round(draftMeta.confidence * 100)}%</Badge>
          {draftMeta.followUp && <span>· Suggested follow-up: {draftMeta.followUp}</span>}
        </div>
      )}
      <div className="rounded-xl border border-border focus-within:ring-2 focus-within:ring-ring">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          rows={2}
          placeholder="Write a reply…  (⌘↵ to send)"
          className="w-full resize-none bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
          <button
            type="button"
            onClick={generateDraft}
            disabled={drafting || pending}
            title="Draft a reply with AI"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent disabled:opacity-60"
          >
            {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {drafting ? "Drafting…" : "AI draft"}
          </button>
          <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
            <Send className="size-3.5" />
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
