"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectWhatsAppAction, type WhatsAppFormState } from "./whatsapp-actions";

const INITIAL: WhatsAppFormState = { error: null, notice: null };

export function WhatsAppConnectForm() {
  const [state, formAction, pending] = useActionState(connectWhatsAppAction, INITIAL);

  return (
    <form action={formAction} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input name="wabaId" placeholder="WhatsApp Business Account ID" required autoComplete="off" />
        <Input name="phoneNumberId" placeholder="Phone number ID" required autoComplete="off" />
        <Input name="displayPhoneNumber" placeholder="Display phone number" required autoComplete="off" />
        <Input
          name="accessToken"
          type="password"
          placeholder="System-user access token"
          required
          autoComplete="off"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Connecting…" : "Connect WhatsApp number"}
      </Button>
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.notice ? <p className="text-xs text-muted-foreground">{state.notice}</p> : null}
    </form>
  );
}
