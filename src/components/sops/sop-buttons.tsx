"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Loader2 } from "lucide-react";
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
import { createSOPAction, generateSOPAction } from "@/app/[workspace]/sops/actions";

export function NewSopButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const res = await createSOPAction(slug, { title: "Untitled SOP", body: "" });
      if (res.ok) router.push(`/${slug}/sops/${res.id}`);
      else alert(res.error);
    });
  }

  return (
    <Button variant="secondary" size="sm" onClick={create} disabled={pending}>
      <Plus className="size-4" />
      New SOP
    </Button>
  );
}

export function GenerateSopButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");

  function generate() {
    if (!topic.trim()) {
      setError("Describe what the SOP should cover.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await generateSOPAction(slug, {
        topic: topic.trim(),
        businessType: businessType.trim() || undefined,
        desiredOutcome: desiredOutcome.trim() || undefined,
      });
      if (res.ok) {
        setOpen(false);
        router.push(`/${slug}/sops/${res.id}`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        Generate with AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate an SOP with AI</DialogTitle>
            <DialogDescription>
              Describe the situation; AI drafts a structured SOP you can edit and approve.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>What should this SOP cover?</Label>
              <Textarea
                rows={2}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Handling refund requests from angry customers"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Business type (optional)</Label>
                <Input
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  placeholder="e.g. beauty salon"
                />
              </div>
              <div>
                <Label>Desired outcome (optional)</Label>
                <Input
                  value={desiredOutcome}
                  onChange={(e) => setDesiredOutcome(e.target.value)}
                  placeholder="e.g. keep the customer, stay on policy"
                />
              </div>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {pending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
