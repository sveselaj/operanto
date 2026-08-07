"use client";

import { useState, useTransition } from "react";
import { mintBridgeGrantAction } from "./actions";

/**
 * Bridge pairing panel. The token appears exactly once, in this client
 * component's state — never in a URL, never re-fetchable. The user pastes
 * it into the Operanto Computer Bridge extension on the tab they choose to
 * share.
 */
export function BridgePanel({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    token?: string;
    expiresAt?: string;
    error?: string;
  } | null>(null);

  return (
    <div className="rounded-md border p-3 text-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setResult(await mintBridgeGrantAction(sessionId)))
        }
        className="h-9 rounded-md border border-input bg-background px-3 font-medium hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Creating pairing token…" : "Create pairing token"}
      </button>
      {result?.error ? (
        <p className="mt-2 text-destructive">{result.error}</p>
      ) : null}
      {result?.token ? (
        <div className="mt-2">
          <p className="mb-1 text-muted-foreground">
            Paste this token into the Operanto Computer Bridge extension on the
            tab you want to share. It is shown only once and expires{" "}
            {result.expiresAt ? new Date(result.expiresAt).toLocaleTimeString() : "soon"}
            .
          </p>
          <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
            {result.token}
          </code>
        </div>
      ) : null}
    </div>
  );
}
