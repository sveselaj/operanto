"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Sparkles, Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";
import { documentStatusVariant } from "@/lib/labels";
import {
  uploadDocumentAction,
  extractDocumentAction,
  deleteDocumentAction,
  type ActionResult,
} from "@/app/[workspace]/opportunities/ops-actions";

export type DocumentView = {
  id: string;
  fileName: string;
  kind: string;
  status: string;
  sizeBytes: number | null;
  createdAt: string;
  extraction: { data: Record<string, string> } | null;
};

export function DocumentsManager({
  slug,
  opportunityId,
  documents,
  canManage,
}: {
  slug: string;
  opportunityId: string;
  documents: DocumentView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadDocumentAction(slug, opportunityId, fd);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" onChange={onFile} className="hidden" />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      )}

      <div className="space-y-1.5">
        {documents.length === 0 && <p className="text-sm text-muted-foreground">No documents.</p>}
        {documents.map((d) => (
          <div key={d.id} className="rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{d.kind}</Badge>
                <span className="truncate font-medium">{d.fileName}</span>
                <Badge variant={documentStatusVariant[d.status as keyof typeof documentStatusVariant] ?? "outline"}>
                  {d.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {canManage && d.status !== "extracted" && (
                  <button onClick={() => run(() => extractDocumentAction(slug, opportunityId, d.id))} disabled={pending} className="text-primary hover:opacity-80" title="Extract data">
                    <Sparkles className="size-3.5" />
                  </button>
                )}
                <a href={`/api/documents/${d.id}`} className="text-muted-foreground hover:text-foreground" title="Download" target="_blank" rel="noreferrer">
                  <Download className="size-3.5" />
                </a>
                {canManage && (
                  <button onClick={() => run(() => deleteDocumentAction(slug, opportunityId, d.id))} className="text-muted-foreground hover:text-danger" title="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
            {d.extraction && Object.keys(d.extraction.data).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(d.extraction.data).map(([k, v]) => (
                  <Badge key={k} variant="primary">{k}: {v}</Badge>
                ))}
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">{relativeTime(d.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
