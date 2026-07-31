"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Loader2, Mic2 } from "lucide-react";
import type { ContentChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ContentDialog, type VoiceOption } from "@/components/studio/content-dialog";
import { BrandVoiceManager, type BrandVoiceData } from "@/components/studio/brand-voice-manager";
import { generateContentAction } from "@/app/[workspace]/studio/actions";

const CHANNELS: ContentChannel[] = ["instagram", "facebook", "tiktok", "email", "blog", "ad", "other"];

export function StudioHeaderActions({
  slug,
  voices,
  voiceData,
}: {
  slug: string;
  voices: VoiceOption[];
  voiceData: BrandVoiceData[];
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ContentChannel>("instagram");
  const [goal, setGoal] = useState("");
  const [voice, setVoice] = useState("");

  function generate() {
    if (!goal.trim()) {
      setError("Describe what to create.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await generateContentAction(slug, {
        channel,
        goal: goal.trim(),
        brandVoiceId: voice || null,
      });
      if (res.ok) {
        setGenOpen(false);
        setGoal("");
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setVoicesOpen(true)}>
        <Mic2 className="size-4" />
        Brand voices
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
        <Plus className="size-4" />
        New
      </Button>
      <Button size="sm" onClick={() => setGenOpen(true)}>
        <Sparkles className="size-4" />
        Generate with AI
      </Button>

      <ContentDialog slug={slug} voices={voices} open={newOpen} onOpenChange={setNewOpen} />
      <BrandVoiceManager
        slug={slug}
        open={voicesOpen}
        onOpenChange={setVoicesOpen}
        voices={voiceData}
      />

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate content with AI</DialogTitle>
            <DialogDescription>
              Describe the goal; AI drafts on-brand content you can edit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>What should this content do?</Label>
              <Textarea
                rows={2}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Explain our pricing for hydrafacials and drive bookings"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                  <option value="">Auto (first voice)</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {pending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
