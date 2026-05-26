"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Archive, Save } from "lucide-react";
import type { SopStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateSOPAction, setSOPStatusAction } from "@/app/[workspace]/sops/actions";

const STATUS_VARIANT: Record<SopStatus, "default" | "success" | "warning"> = {
  draft: "warning",
  approved: "success",
  archived: "default",
};

export type SopData = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  body: string;
  status: SopStatus;
  version: number;
};

export function SopEditor({
  slug,
  sop,
  canEdit,
  canApprove,
  meta,
}: {
  slug: string;
  sop: SopData;
  canEdit: boolean;
  canApprove: boolean;
  meta: { createdBy?: string | null; approvedBy?: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [title, setTitle] = useState(sop.title);
  const [description, setDescription] = useState(sop.description ?? "");
  const [category, setCategory] = useState(sop.category ?? "");
  const [body, setBody] = useState(sop.body);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateSOPAction(slug, sop.id, { title, description, category, body });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else setError(res.error);
    });
  }

  function changeStatus(status: SopStatus) {
    startTransition(async () => {
      const res = await setSOPStatusAction(slug, sop.id, status);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/${slug}/sops`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> SOPs
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[sop.status]}>{sop.status}</Badge>
          <span className="text-xs text-muted-foreground">v{sop.version}</span>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div>
          <Label>Body</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!canEdit}
            rows={18}
            className="font-mono text-xs leading-relaxed"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button onClick={save} disabled={pending}>
            <Save className="size-4" />
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
        {saved && <span className="text-xs text-success">Saved.</span>}

        {canApprove && sop.status === "draft" && (
          <Button variant="secondary" onClick={() => changeStatus("approved")} disabled={pending}>
            <Check className="size-4" /> Approve
          </Button>
        )}
        {canEdit && sop.status !== "archived" && (
          <Button variant="ghost" onClick={() => changeStatus("archived")} disabled={pending}>
            <Archive className="size-4" /> Archive
          </Button>
        )}
        {canEdit && sop.status === "archived" && (
          <Button variant="ghost" onClick={() => changeStatus("draft")} disabled={pending}>
            Restore to draft
          </Button>
        )}

        <span className="ml-auto text-[11px] text-muted-foreground">
          {meta.createdBy && `Created by ${meta.createdBy}`}
          {meta.approvedBy && ` · Approved by ${meta.approvedBy}`}
        </span>
      </div>

      {sop.status === "approved" && canEdit && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Editing the body of an approved SOP returns it to draft and bumps the version.
        </p>
      )}
    </div>
  );
}
