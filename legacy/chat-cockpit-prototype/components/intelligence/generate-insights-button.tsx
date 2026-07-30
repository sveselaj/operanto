"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateInsightsAction } from "@/app/[workspace]/intelligence/actions";

export function GenerateInsightsButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await generateInsightsAction(slug);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  return (
    <Button size="sm" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {pending ? "Analyzing…" : "Generate insights"}
    </Button>
  );
}
