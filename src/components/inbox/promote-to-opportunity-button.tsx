"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Target, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { promoteConversationAction } from "@/app/[workspace]/opportunities/actions";

/** Promote a conversation to an Opportunity, or link to the existing one. */
export function PromoteToOpportunityButton({
  slug,
  conversationId,
  opportunityId,
}: {
  slug: string;
  conversationId: string;
  opportunityId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (opportunityId) {
    return (
      <Link
        href={`/${slug}/opportunities/${opportunityId}`}
        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-1.5">
          <Target className="size-3.5 text-primary" /> View opportunity
        </span>
        <ArrowUpRight className="size-3.5 text-muted-foreground" />
      </Link>
    );
  }

  function promote() {
    startTransition(async () => {
      const res = await promoteConversationAction(slug, conversationId);
      if (res.ok) router.push(`/${slug}/opportunities/${res.opportunityId}`);
      else alert(res.error);
    });
  }

  return (
    <Button variant="outline" className="w-full" onClick={promote} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Target className="size-3.5" />}
      {pending ? "Promoting…" : "Promote to opportunity"}
    </Button>
  );
}
