"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Lightbulb, Pencil, Trash2 } from "lucide-react";
import type { ContentChannel, ContentStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  ContentDialog,
  type VoiceOption,
  type EditableContent,
} from "@/components/studio/content-dialog";
import { updateContentAction, deleteContentAction } from "@/app/[workspace]/studio/actions";

const STATUSES: ContentStatus[] = ["idea", "draft", "review", "approved", "published"];

export type ContentCardData = {
  id: string;
  title: string;
  channel: ContentChannel;
  content: string;
  status: ContentStatus;
  brandVoiceId: string | null;
  brandVoiceName: string | null;
  sourceConversationId: string | null;
  sourceCustomerName: string | null;
  fromInsight: boolean;
};

export function ContentCard({
  slug,
  item,
  voices,
}: {
  slug: string;
  item: ContentCardData;
  voices: VoiceOption[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function changeStatus(status: ContentStatus) {
    startTransition(async () => {
      const res = await updateContentAction(slug, item.id, { status });
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }
  function remove() {
    if (!confirm("Delete this content draft?")) return;
    startTransition(async () => {
      const res = await deleteContentAction(slug, item.id);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  const edit: EditableContent = {
    id: item.id,
    title: item.title,
    channel: item.channel,
    content: item.content,
    status: item.status,
    brandVoiceId: item.brandVoiceId,
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{item.title}</p>
        <div className="flex shrink-0 gap-0.5">
          <button
            onClick={() => setEditOpen(true)}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            title="Edit"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={remove}
            disabled={pending}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
        {item.content || "No content yet."}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="primary" className="capitalize">
          {item.channel}
        </Badge>
        {item.brandVoiceName && <Badge variant="outline">{item.brandVoiceName}</Badge>}
        {item.sourceConversationId && (
          <Link
            href={`/${slug}/inbox/${item.sourceConversationId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <MessageSquare className="size-3" />
            {item.sourceCustomerName ?? "source"}
          </Link>
        )}
        {item.fromInsight && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lightbulb className="size-3" /> from insight
          </span>
        )}
      </div>

      <div className="mt-3">
        <select
          value={item.status}
          disabled={pending}
          onChange={(e) => changeStatus(e.target.value as ContentStatus)}
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs capitalize focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </select>
      </div>

      <ContentDialog
        slug={slug}
        voices={voices}
        open={editOpen}
        onOpenChange={setEditOpen}
        item={edit}
      />
    </div>
  );
}
