"use client";

import { useActionState, useState } from "react";
import { TELEPHONY_PROVIDERS, telephonyProvider } from "@/lib/telephony-providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectTelephonyAction,
  type ConnectTelephonyState,
} from "./telephony-actions";

/**
 * Provider-adaptive connection form: selecting a provider renders exactly the
 * credential fields its catalog entry declares. Secrets are write-only — the
 * server never returns them; the webhook signing secret is displayed once.
 */
export function TelephonyConnectForm() {
  const [providerId, setProviderId] = useState(TELEPHONY_PROVIDERS[0].id);
  const [state, formAction, pending] = useActionState<ConnectTelephonyState, FormData>(
    connectTelephonyAction,
    {},
  );
  const spec = telephonyProvider(providerId) ?? TELEPHONY_PROVIDERS[0];

  if (state.ok && state.webhookSecret) {
    return (
      <div className="space-y-2 rounded-md border border-border p-4 text-sm">
        <p className="font-medium">Telephony connection saved.</p>
        <p className="text-muted-foreground">
          If your provider supports call-event webhooks, configure them with this
          signing secret. It is shown only once — reconnecting generates a new one.
        </p>
        <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
          {state.webhookSecret}
        </code>
        <p className="text-muted-foreground">
          The webhook endpoint URL and live call features arrive with the
          provider adapter; inbound/outbound stay off until enabled below.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="telephony-provider">Provider</Label>
        <select
          id="telephony-provider"
          name="provider"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {TELEPHONY_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{spec.credentialsHint}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="telephony-name">Display name</Label>
        <Input
          id="telephony-name"
          name="displayName"
          placeholder={`${spec.label} main line`}
          required
          maxLength={100}
        />
      </div>
      {spec.fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`telephony-${field.key}`}>{field.label}</Label>
          <Input
            id={`telephony-${field.key}`}
            name={field.key}
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            placeholder={field.placeholder}
            required={!field.label.toLowerCase().includes("optional")}
          />
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save connection"}
      </Button>
    </form>
  );
}
