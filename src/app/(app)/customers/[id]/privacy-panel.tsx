"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eraseCustomerAction, type PrivacyResult } from "./actions";

/**
 * Erasure is irreversible, so it asks for a reason (which is audited) and a
 * typed confirmation rather than presenting a single destructive button.
 */
export function ErasureForm({ customerId }: { customerId: string }) {
  const [result, formAction, pending] = useActionState<PrivacyResult | null, FormData>(
    eraseCustomerAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="customerId" value={customerId} />
      <Input
        name="reason"
        placeholder="Reason (recorded in the audit log)"
        required
        maxLength={500}
      />
      <Input name="confirm" placeholder="Type ERASE to confirm" required />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Erasing…" : "Erase personal data"}
      </Button>
      {result?.error ? (
        <p role="alert" className="text-xs text-danger">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? <p className="text-xs text-success">{result.ok}</p> : null}
    </form>
  );
}
