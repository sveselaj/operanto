"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";

export function ChannelWidgetLink({ channelAccountId }: { channelAccountId: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/widget/${channelAccountId}`;

  function copy() {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <a
        href={path}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <ExternalLink className="size-3" /> Open widget
      </a>
      <button
        onClick={copy}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
