"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { analyzeConversationAction } from "@/app/[workspace]/inbox/actions";

export function AnalyzeButton({
  slug,
  conversationId,
  hasSummary,
}: {
  slug: string;
  conversationId: string;
  hasSummary: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await analyzeConversationAction(slug, conversationId);
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-accent disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
      {pending ? "Analyzing…" : hasSummary ? "Re-analyze" : "Analyze"}
    </button>
  );
}
