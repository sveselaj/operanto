"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addMessageAction, addNoteAction, type ComposerResult } from "./actions";

function useResettingForm(result: ComposerResult) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result && "ok" in result) formRef.current?.reset();
  }, [result]);
  return formRef;
}

export function MessageComposer({
  conversationId,
  disabled,
  disabledReason,
}: {
  conversationId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [result, formAction, pending] = useActionState<ComposerResult, FormData>(
    addMessageAction,
    null,
  );
  const formRef = useResettingForm(result);

  if (disabled) {
    return (
      <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
        {disabledReason ?? "New messages cannot be recorded for this conversation."}
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Textarea
        name="body"
        rows={3}
        required
        placeholder="Record a message (nothing is sent anywhere — manual channel)"
        aria-label="Message"
      />
      {result && "error" in result ? (
        <p role="alert" className="text-xs text-danger">
          {result.error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Recording…" : "Record message"}
      </Button>
    </form>
  );
}

export function NoteForm({ conversationId }: { conversationId: string }) {
  const [result, formAction, pending] = useActionState<ComposerResult, FormData>(
    addNoteAction,
    null,
  );
  const formRef = useResettingForm(result);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Textarea
        name="body"
        rows={2}
        required
        placeholder="Add an internal note (never visible to the customer)"
        aria-label="Internal note"
      />
      {result && "error" in result ? (
        <p role="alert" className="text-xs text-danger">
          {result.error}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}
