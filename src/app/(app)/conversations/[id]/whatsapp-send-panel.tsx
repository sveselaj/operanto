"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendWhatsAppAction, type SendWhatsAppResult } from "./actions";

/**
 * Explicit outbound WhatsApp send. Deliberately SEPARATE from the manual
 * composer (which only records) and from AI approval (which never sends).
 * Everything shown here is advisory — the server recalculates the window,
 * consent, template and connection state at the moment of the send.
 */

export type SendPanelTemplate = {
  id: string;
  name: string;
  language: string;
  body: string;
};

export function WhatsAppSendPanel({
  conversationId,
  withinWindow,
  windowExpiresAt,
  templates,
  disabled,
  disabledReason,
}: {
  conversationId: string;
  withinWindow: boolean;
  windowExpiresAt: string | null;
  templates: SendPanelTemplate[];
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState<SendWhatsAppResult, FormData>(
    sendWhatsAppAction,
    null,
  );
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [templateId, setTemplateId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const lastState = useRef<SendWhatsAppResult>(null);

  useEffect(() => {
    if (state !== lastState.current && state && "ok" in state) {
      // A completed send consumes its idempotency key; mint a fresh one.
      setIdempotencyKey(crypto.randomUUID());
      formRef.current?.reset();
      setTemplateId("");
    }
    lastState.current = state;
  }, [state]);

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  return (
    <section
      data-testid="whatsapp-send-panel"
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Send via WhatsApp</h2>
        <span
          className={
            withinWindow
              ? "rounded-full border border-primary/40 px-2 py-0.5 text-xs text-primary"
              : "rounded-full border border-warning/50 px-2 py-0.5 text-xs text-warning"
          }
        >
          {withinWindow
            ? `Service window open${windowExpiresAt ? ` until ${new Date(windowExpiresAt).toLocaleString()}` : ""}`
            : "Service window closed — approved template required"}
        </span>
      </div>
      <div className="space-y-2 px-4 py-3">
        {disabled ? (
          <p className="text-sm text-muted-foreground">{disabledReason}</p>
        ) : (
          <form ref={formRef} action={formAction} className="space-y-2">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            {!withinWindow ? (
              <select
                name="templateId"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                required
                aria-label="Approved template"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select an approved template…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.language})
                  </option>
                ))}
              </select>
            ) : null}
            {selectedTemplate ? (
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                {selectedTemplate.body}
              </p>
            ) : null}
            {withinWindow ? (
              <textarea
                name="body"
                rows={3}
                required
                placeholder="Write the reply to send on WhatsApp…"
                aria-label="WhatsApp message"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Sending…" : "Send WhatsApp message"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Sends externally after server-side consent, window and template
                checks.
              </p>
            </div>
            {state && "error" in state ? (
              <p role="alert" className="text-xs text-red-600">
                {state.error}
              </p>
            ) : null}
            {state && "ok" in state ? (
              <p className="text-xs text-muted-foreground">
                Message {state.deliveryStatus === "SENT" ? "sent" : state.deliveryStatus.toLowerCase()}.
              </p>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}
