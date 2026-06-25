"use client";

import { useState, useTransition } from "react";
import { Sparkles, ListChecks, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  extractRequirementsAction,
  detectMissingInfoAction,
} from "@/app/[workspace]/opportunities/actions";

/** Extract requirements + detect missing info for an opportunity (Lead Engine AI). */
export function OpportunityAiButtons({
  slug,
  opportunityId,
}: {
  slug: string;
  opportunityId: string;
}) {
  const [extracting, startExtract] = useTransition();
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<
    { complete: boolean; labels: string[]; message: string | null } | null
  >(null);
  const [copied, setCopied] = useState(false);

  function extract() {
    setError(null);
    startExtract(async () => {
      const res = await extractRequirementsAction(slug, opportunityId);
      if (!res.ok) setError(res.error);
    });
  }

  async function detect() {
    setError(null);
    setMissing(null);
    setDetecting(true);
    const res = await detectMissingInfoAction(slug, opportunityId);
    setDetecting(false);
    if (res.ok) setMissing({ complete: res.complete, labels: res.missingLabels, message: res.message });
    else setError(res.error);
  }

  function copy() {
    if (missing?.message) {
      navigator.clipboard.writeText(missing.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={extract} disabled={extracting}>
          {extracting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {extracting ? "Extracting…" : "Extract requirements"}
        </Button>
        <Button size="sm" variant="outline" onClick={detect} disabled={detecting}>
          {detecting ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />}
          {detecting ? "Checking…" : "Detect missing info"}
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {missing && missing.complete && (
        <p className="text-xs text-success">All required information has been collected. ✓</p>
      )}
      {missing && !missing.complete && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Still missing: {missing.labels.join(", ")}
          </p>
          {missing.message && (
            <>
              <p className="mt-2 whitespace-pre-wrap text-foreground">{missing.message}</p>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={copy}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy draft"}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Review and send from the conversation.
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
