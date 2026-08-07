"use client";

import { useState, useTransition } from "react";
import { issueNavigationCodeAction } from "./actions";

/**
 * C4 execution panel. The one-shot code appears exactly once, here, after
 * the navigation has been approved — it is never stored raw, never audited,
 * never put in a URL. The operator pastes it into the extension, which
 * independently revalidates the target before navigating once.
 */
export function NavigationCodePanel({ actionId }: { actionId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    nonce?: string;
    expiresAt?: string;
    error?: string;
  } | null>(null);

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setResult(await issueNavigationCodeAction(actionId)))
        }
        className="h-8 rounded-md border border-input px-2 text-xs hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Issuing…" : "Issue one-shot execution code"}
      </button>
      {result?.error ? (
        <p className="mt-1 text-xs text-destructive">{result.error}</p>
      ) : null}
      {result?.nonce ? (
        <div className="mt-1">
          <p className="text-xs text-muted-foreground">
            Paste into the extension and press “Open the approved link once”.
            Single use; expires{" "}
            {result.expiresAt ? new Date(result.expiresAt).toLocaleTimeString() : "shortly"}.
          </p>
          <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
            {result.nonce}
          </code>
        </div>
      ) : null}
    </div>
  );
}
