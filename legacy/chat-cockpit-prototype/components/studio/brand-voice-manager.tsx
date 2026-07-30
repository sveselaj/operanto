"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
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
import {
  createBrandVoiceAction,
  updateBrandVoiceAction,
  deleteBrandVoiceAction,
  type BrandVoiceFields,
} from "@/app/[workspace]/studio/actions";

export type BrandVoiceData = {
  id: string;
  name: string;
  description: string | null;
  tone: string | null;
  language: string;
  dos: string[];
  donts: string[];
  examplePhrases: string[];
};

const toLines = (arr: string[]) => arr.join("\n");
const fromLines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function VoiceForm({
  slug,
  voice,
  onDone,
  onCancel,
}: {
  slug: string;
  voice?: BrandVoiceData;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = !!voice;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(voice?.name ?? "");
  const [tone, setTone] = useState(voice?.tone ?? "");
  const [description, setDescription] = useState(voice?.description ?? "");
  const [dos, setDos] = useState(toLines(voice?.dos ?? []));
  const [donts, setDonts] = useState(toLines(voice?.donts ?? []));
  const [examples, setExamples] = useState(toLines(voice?.examplePhrases ?? []));

  function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    const fields: BrandVoiceFields = {
      name,
      tone,
      description,
      dos: fromLines(dos),
      donts: fromLines(donts),
      examplePhrases: fromLines(examples),
    };
    startTransition(async () => {
      const res = editing
        ? await updateBrandVoiceAction(slug, voice!.id, fields)
        : await createBrandVoiceAction(slug, fields);
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onCancel}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back
      </button>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>Tone</Label>
          <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="warm, concise" />
        </div>
      </div>
      <div>
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Do (one per line)</Label>
          <Textarea rows={3} value={dos} onChange={(e) => setDos(e.target.value)} />
        </div>
        <div>
          <Label>Don&apos;t (one per line)</Label>
          <Textarea rows={3} value={donts} onChange={(e) => setDonts(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Example phrases (one per line)</Label>
        <Textarea rows={2} value={examples} onChange={(e) => setExamples(e.target.value)} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Create voice"}
        </Button>
      </div>
    </div>
  );
}

export function BrandVoiceManager({
  slug,
  open,
  onOpenChange,
  voices,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  voices: BrandVoiceData[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "new" } | { kind: "edit"; voice: BrandVoiceData }>({
    kind: "list",
  });

  function refresh() {
    setMode({ kind: "list" });
    router.refresh();
  }
  function remove(id: string) {
    if (!confirm("Delete this brand voice?")) return;
    startTransition(async () => {
      const res = await deleteBrandVoiceAction(slug, id);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setMode({ kind: "list" });
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Brand voices</DialogTitle>
          <DialogDescription>
            Define how AI writes for you — tone, do&apos;s, don&apos;ts, and example phrases.
          </DialogDescription>
        </DialogHeader>

        {mode.kind === "list" && (
          <div className="space-y-2">
            {voices.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">No brand voices yet.</p>
            )}
            {voices.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{v.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {v.tone ?? v.description ?? "—"}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setMode({ kind: "edit", voice: v })}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => remove(v.id)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <Button variant="secondary" className="w-full" onClick={() => setMode({ kind: "new" })}>
              <Plus className="size-4" /> New brand voice
            </Button>
          </div>
        )}

        {mode.kind === "new" && (
          <VoiceForm slug={slug} onDone={refresh} onCancel={() => setMode({ kind: "list" })} />
        )}
        {mode.kind === "edit" && (
          <VoiceForm
            slug={slug}
            voice={mode.voice}
            onDone={refresh}
            onCancel={() => setMode({ kind: "list" })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
