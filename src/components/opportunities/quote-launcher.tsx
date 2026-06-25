"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createQuoteAction, draftQuoteAction } from "@/app/[workspace]/opportunities/quote-actions";

/** Create an empty quote or AI-draft one for an opportunity, then open the builder. */
export function QuoteLauncher({ slug, opportunityId }: { slug: string; opportunityId: string }) {
  const router = useRouter();
  const [drafting, startDraft] = useTransition();
  const [creating, startCreate] = useTransition();

  function open(quoteId: string) {
    router.push(`/${slug}/opportunities/${opportunityId}/quotes/${quoteId}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={drafting}
        onClick={() =>
          startDraft(async () => {
            const res = await draftQuoteAction(slug, opportunityId);
            if (res.ok) open(res.quoteId);
            else alert(res.error);
          })
        }
      >
        {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {drafting ? "Drafting…" : "Draft with AI"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={creating}
        onClick={() =>
          startCreate(async () => {
            const res = await createQuoteAction(slug, opportunityId);
            if (res.ok) open(res.quoteId);
            else alert(res.error);
          })
        }
      >
        <Plus className="size-3.5" /> New quote
      </Button>
    </div>
  );
}
