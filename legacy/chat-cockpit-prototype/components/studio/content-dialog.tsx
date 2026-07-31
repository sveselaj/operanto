"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContentChannel, ContentStatus } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createContentAction, updateContentAction } from "@/app/[workspace]/studio/actions";

export type VoiceOption = { id: string; name: string };

const CHANNELS: ContentChannel[] = ["instagram", "facebook", "tiktok", "email", "blog", "ad", "other"];
const STATUSES: ContentStatus[] = ["idea", "draft", "review", "approved", "published"];

export type EditableContent = {
  id: string;
  title: string;
  channel: ContentChannel;
  content: string;
  status: ContentStatus;
  brandVoiceId: string | null;
};

export function ContentDialog({
  slug,
  voices,
  open,
  onOpenChange,
  item,
}: {
  slug: string;
  voices: VoiceOption[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item?: EditableContent;
}) {
  const router = useRouter();
  const editing = !!item;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(item?.title ?? "");
  const [channel, setChannel] = useState<ContentChannel>(item?.channel ?? "instagram");
  const [status, setStatus] = useState<ContentStatus>(item?.status ?? "idea");
  const [voice, setVoice] = useState(item?.brandVoiceId ?? "");
  const [body, setBody] = useState(item?.content ?? "");

  function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = editing
        ? await updateContentAction(slug, item!.id, {
            title,
            channel,
            content: body,
            status,
            brandVoiceId: voice || null,
          })
        : await createContentAction(slug, {
            title,
            channel,
            content: body,
            brandVoiceId: voice || null,
          });
      if (res.ok) {
        onOpenChange(false);
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit content" : "New content"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update this content draft." : "Draft content for your channels."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Channel</Label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as ContentChannel)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Brand voice</Label>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">None</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            {editing && (
              <div>
                <Label>Status</Label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ContentStatus)}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s} className="capitalize">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <Label>Content</Label>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
