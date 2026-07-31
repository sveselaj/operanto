"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  beginEnrolmentAction,
  confirmEnrolmentAction,
  disableTwoFactorAction,
  type EnrolmentState,
} from "./two-factor-actions";

export function TwoFactorPanel({
  active,
  required,
  recoveryCodesRemaining,
}: {
  active: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}) {
  const [enrolment, setEnrolment] = useState<EnrolmentState | null>(null);
  const [confirmState, confirmAction, confirming] = useActionState<
    EnrolmentState | null,
    FormData
  >(confirmEnrolmentAction, null);
  const [disableState, disableAction, disabling] = useActionState<
    EnrolmentState | null,
    FormData
  >(disableTwoFactorAction, null);

  // Shown once, immediately after enrolment — never retrievable afterwards.
  if (confirmState?.recoveryCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-success">
          Two-factor authentication is on.
        </p>
        <p className="text-sm">
          Save these recovery codes somewhere safe. Each works once, and they
          are the only way in if you lose your phone. They will not be shown
          again.
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-3 font-mono text-sm">
          {confirmState.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (active) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-success">Two-factor authentication is on.</p>
        <p className="text-muted-foreground">
          {recoveryCodesRemaining} recovery code
          {recoveryCodesRemaining === 1 ? "" : "s"} remaining.
        </p>
        {required ? (
          <p className="text-muted-foreground">
            Your role requires two-factor authentication, so it cannot be turned
            off while you hold it.
          </p>
        ) : (
          <form action={disableAction} className="space-y-2">
            <Input
              name="token"
              placeholder="Current code, to confirm it is you"
              required
            />
            <Button type="submit" variant="outline" size="sm" disabled={disabling}>
              {disabling ? "Turning off…" : "Turn off two-factor"}
            </Button>
            {disableState?.error ? (
              <p role="alert" className="text-xs text-danger">
                {disableState.error}
              </p>
            ) : null}
          </form>
        )}
      </div>
    );
  }

  if (!enrolment?.secret) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {required
            ? "Your role requires two-factor authentication. Set it up to keep access."
            : "Add a second step at sign-in using an authenticator app."}
        </p>
        <form
          action={async () => {
            setEnrolment(await beginEnrolmentAction());
          }}
        >
          <Button type="submit" variant="outline" size="sm">
            Set up two-factor
          </Button>
        </form>
        {enrolment?.error ? (
          <p role="alert" className="text-xs text-danger">
            {enrolment.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p>
        In your authenticator app choose “add account”, then enter this key:
      </p>
      <code className="block break-all rounded-md border border-border bg-muted p-3 font-mono text-sm">
        {enrolment.secret}
      </code>
      <p className="text-xs text-muted-foreground">
        Account name: Operanto. Time-based, 6 digits, 30 seconds.
      </p>
      <form action={confirmAction} className="space-y-2">
        <Label htmlFor="confirm-token">Enter the code it shows</Label>
        <Input
          id="confirm-token"
          name="token"
          inputMode="numeric"
          placeholder="6-digit code"
          required
        />
        <Button type="submit" variant="outline" size="sm" disabled={confirming}>
          {confirming ? "Checking…" : "Confirm and turn on"}
        </Button>
        {confirmState?.error ? (
          <p role="alert" className="text-xs text-danger">
            {confirmState.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
