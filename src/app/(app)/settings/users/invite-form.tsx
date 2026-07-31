"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMemberAction, type InviteResult } from "./actions";

export function InviteForm() {
  const [result, formAction, pending] = useActionState<InviteResult | null, FormData>(
    inviteMemberAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-2">
      <Input name="email" type="email" placeholder="colleague@company.com" required />
      <select
        name="role"
        defaultValue="OPERATOR"
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        aria-label="Role"
      >
        <option value="OPERATOR">OPERATOR</option>
        <option value="SUPERVISOR">SUPERVISOR</option>
        <option value="ADMIN">ADMIN</option>
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Inviting…" : "Send invitation"}
      </Button>
      {result?.error ? (
        <p role="alert" className="text-xs text-danger">
          {result.error}
        </p>
      ) : null}
      {result?.ok && !result.undelivered ? (
        <p className="text-xs text-success">Invitation created and sent.</p>
      ) : null}
      {result?.undelivered ? (
        <p className="text-xs text-warning">
          Invitation created but NOT delivered: {result.undelivered}. Use
          “Resend” once email is configured.
        </p>
      ) : null}
      {result?.devInviteUrl ? (
        <p className="break-all text-xs text-muted-foreground">
          Development preview — share this link manually:{" "}
          {result.devInviteUrl}
        </p>
      ) : null}
    </form>
  );
}
