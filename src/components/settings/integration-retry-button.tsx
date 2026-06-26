"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { retryIntegrationAction } from "@/app/[workspace]/settings/actions";

export function IntegrationRetryButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await retryIntegrationAction(slug, id);
          if (res.ok) router.refresh();
          else alert(res.error);
        })
      }
      className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
    >
      <RotateCw className="size-3" /> Retry
    </button>
  );
}
