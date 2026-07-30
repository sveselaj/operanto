"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Loader2 } from "lucide-react";
import { generateFromConversationAction } from "@/app/[workspace]/studio/actions";

export function GenerateContentButton({
  slug,
  conversationId,
}: {
  slug: string;
  conversationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await generateFromConversationAction(slug, conversationId, "instagram");
      if (res.ok) router.push(`/${slug}/studio`);
      else alert(res.error);
    });
  }

  return (
    <button
      onClick={run}
      disabled={pending}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
      {pending ? "Generating…" : "Generate content from this conversation"}
    </button>
  );
}
