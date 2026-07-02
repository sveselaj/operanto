"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createThreadAction } from "@/app/[workspace]/assistant/actions";

export function NewThreadButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createThreadAction(slug);
          if (res.ok) router.push(`/${slug}/assistant/${res.id}`);
        })
      }
      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      <Plus className="size-4" /> New chat
    </button>
  );
}
