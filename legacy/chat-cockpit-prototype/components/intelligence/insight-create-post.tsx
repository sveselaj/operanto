"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Loader2 } from "lucide-react";
import { generateFromInsightAction } from "@/app/[workspace]/studio/actions";

export function InsightCreatePost({
  slug,
  insightId,
}: {
  slug: string;
  insightId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await generateFromInsightAction(slug, insightId, "instagram");
      if (res.ok) router.push(`/${slug}/studio`);
      else alert(res.error);
    });
  }

  return (
    <button
      onClick={run}
      disabled={pending}
      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <PenLine className="size-3" />}
      {pending ? "Generating…" : "Create post"}
    </button>
  );
}
