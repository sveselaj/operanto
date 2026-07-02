"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { openConversationThreadAction } from "@/app/[workspace]/assistant/actions";

/** Opens (or creates) the cockpit assistant thread bound to this conversation. */
export function OpenAssistantButton({
  slug,
  conversationId,
}: {
  slug: string;
  conversationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await openConversationThreadAction(slug, conversationId);
          if (res.ok) router.push(`/${slug}/assistant/${res.id}`);
        })
      }
      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      <Bot className="size-3.5" /> {pending ? "Opening…" : "Open in assistant cockpit"}
    </button>
  );
}
