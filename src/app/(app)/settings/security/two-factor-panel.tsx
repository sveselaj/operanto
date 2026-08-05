"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  beginEnrolmentAction,
  beginRotationAction,
  cancelRotationAction,
  confirmEnrolmentAction,
  confirmRotationAction,
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
  const [rotateState, rotateAction, rotating] = useActionState<
    EnrolmentState | null,
    FormData
  >(beginRotationAction, null);
  const [rotateConfirmState, rotateConfirmAction, rotateConfirming] = useActionState<
    EnrolmentState | null,
    FormData
  >(confirmRotationAction, null);

  // Shown once, immediately after enrolment/rotation — never retrievable after.
  if (rotateConfirmState?.recoveryCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-success">
          New authenticator active. The previous one no longer works.
        </p>
        <p className="text-sm">
          These replacement recovery codes invalidate the old ones. Save them
          somewhere safe — they will not be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-3 font-mono text-sm">
          {rotateConfirmState.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }

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
        {rotateState?.secret ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium">Scan with the NEW authenticator</p>
            <p className="text-xs text-muted-foreground">
              Add this key in the new app, then confirm with the code it shows.
              Your current authenticator keeps working until you confirm.
            </p>
            <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
              {rotateState.secret}
            </code>
            <form action={rotateConfirmAction} className="space-y-2">
              <Input name="token" placeholder="Code from the new app" required />
              <div className="flex gap-2">
                <Button type="submit" variant="outline" size="sm" disabled={rotateConfirming}>
                  {rotateConfirming ? "Confirming…" : "Confirm new authenticator"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelRotationAction()}
                >
                  Cancel
                </Button>
              </div>
              {rotateConfirmState?.error ? (
                <p role="alert" className="text-xs text-danger">
                  {rotateConfirmState.error}
                </p>
              ) : null}
            </form>
          </div>
        ) : (
          <form action={rotateAction} className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium">Replace authenticator</p>
            <p className="text-xs text-muted-foreground">
              Lost your phone, or this account was set up with a shared or test
              secret? Prove the current factor (a recovery code works too) and
              you will get a fresh key to scan.
            </p>
            <Input name="token" placeholder="Current code or recovery code" required />
            <Button type="submit" variant="outline" size="sm" disabled={rotating}>
              {rotating ? "Starting…" : "Replace authenticator"}
            </Button>
            {rotateState?.error ? (
              <p role="alert" className="text-xs text-danger">
                {rotateState.error}
              </p>
            ) : null}
          </form>
        )}
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
