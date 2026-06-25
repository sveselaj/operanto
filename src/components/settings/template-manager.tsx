"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ChannelType, MessageTemplate, TemplateStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { channelLabel } from "@/lib/labels";
import { extractTemplateVariables } from "@/lib/mediasync/templates-render";
import {
  createTemplateAction,
  setTemplateStatusAction,
  deleteTemplateAction,
  type ActionResult,
} from "@/app/[workspace]/settings/actions";

const CHANNELS: ChannelType[] = [
  "whatsapp",
  "sms",
  "email",
  "instagram",
  "facebook",
  "webchat",
  "manual",
];

const STATUS_VARIANT: Record<TemplateStatus, "outline" | "success" | "default"> = {
  draft: "outline",
  approved: "success",
  archived: "default",
};

export function TemplateManager({
  slug,
  templates,
  canManage,
}: {
  slug: string;
  templates: MessageTemplate[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("whatsapp");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detectedVars = extractTemplateVariables(body);

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) after?.();
      else setError(res.error);
    });
  }

  function create() {
    if (!name.trim() || !body.trim()) {
      setError("Name and body are required.");
      return;
    }
    run(
      () =>
        createTemplateAction(slug, {
          name,
          channelType,
          category: category.trim() || undefined,
          body,
        }),
      () => {
        setName("");
        setCategory("");
        setBody("");
      },
    );
  }

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs font-medium text-muted-foreground">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Channel
              <select
                value={channelType}
                onChange={(e) => setChannelType(e.target.value as ChannelType)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Category (optional)
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="utility"
                className="mt-1"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-muted-foreground">
            Body — use {"{{name}}"} placeholders
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Hi {{name}}, your appointment is confirmed for {{date}}."
              className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {detectedVars.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Variables:
              {detectedVars.map((v) => (
                <Badge key={v} variant="outline">
                  {v}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={create} disabled={pending}>
              <Plus className="size-3.5" /> Add template
            </Button>
            {error && <span className="text-xs text-danger">{error}</span>}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground">No templates yet.</p>
        )}
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                <Badge variant="default">{channelLabel[t.channelType]}</Badge>
                <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                {t.category && <span className="text-xs text-muted-foreground">{t.category}</span>}
              </div>
              {canManage && (
                <div className="flex items-center gap-1.5">
                  {t.status !== "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => setTemplateStatusAction(slug, t.id, "approved"))}
                    >
                      Approve
                    </Button>
                  )}
                  {t.status === "approved" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => setTemplateStatusAction(slug, t.id, "draft"))}
                    >
                      Unapprove
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => deleteTemplateAction(slug, t.id))}
                    title="Delete template"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
