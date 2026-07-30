"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rotateSecretAction } from "./actions";

export function RotateSecretForm({ integrationId }: { integrationId: string }) {
  const [message, formAction, pending] = useActionState(rotateSecretAction, null);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="integrationId" value={integrationId} />
      <Input
        name="newSecret"
        type="password"
        placeholder="New shared secret (min 32 chars)"
        minLength={32}
        required
        autoComplete="off"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Rotating…" : "Rotate secret"}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </form>
  );
}
