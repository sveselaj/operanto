"use client";

import { useState, useTransition } from "react";
import { Check, Tag as TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTagsAction } from "@/app/[workspace]/inbox/actions";

type Tag = { id: string; name: string; color: string };

export function TagEditor({
  slug,
  conversationId,
  allTags,
  selectedIds,
  canEdit,
}: {
  slug: string;
  conversationId: string;
  allTags: Tag[];
  selectedIds: string[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    if (!canEdit) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    startTransition(async () => {
      const res = await setTagsAction(slug, conversationId, [...next]);
      if (!res.ok) alert(res.error);
    });
  }

  if (allTags.length === 0) {
    return <p className="text-xs text-muted-foreground">No tags defined yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {allTags.map((t) => {
        const on = selected.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            disabled={!canEdit || pending}
            onClick={() => toggle(t.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60",
              on ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted",
            )}
            style={on ? { background: t.color } : undefined}
          >
            {on ? <Check className="size-3" /> : <TagIcon className="size-3" />}
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
