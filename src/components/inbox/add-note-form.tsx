"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addNoteAction } from "@/app/[workspace]/inbox/actions";

export function AddNoteForm({
  slug,
  conversationId,
}: {
  slug: string;
  conversationId: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addNoteAction(slug, conversationId, body);
      if (res.ok) setBody("");
      else setError(res.error);
    });
  }

  return (
    <div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Add an internal note (only your team sees this)…"
        className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-1.5 flex justify-end">
        <Button size="sm" variant="secondary" onClick={submit} disabled={pending || !body.trim()}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
