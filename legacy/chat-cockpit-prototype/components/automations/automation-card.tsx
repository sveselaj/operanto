"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Play, Zap } from "lucide-react";
import type { AutomationTrigger } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";
import {
  intentLabel,
  sentimentLabel,
  channelLabel,
  priorityLabel,
} from "@/lib/labels";
import { TRIGGERS, type Condition, type Action } from "@/lib/automations/schema";
import {
  AutomationDialog,
  type Opt,
  type EditableAutomation,
} from "@/components/automations/automation-dialog";
import {
  toggleAutomationAction,
  deleteAutomationAction,
  runAutomationNowAction,
} from "@/app/[workspace]/automations/actions";

export type AutomationCardData = {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  conditions: Condition[];
  actions: Action[];
  lastRunAt: string | null;
};

function describeCondition(c: Condition, tags: Opt[]): string {
  switch (c.field) {
    case "intent":
      return `intent is ${intentLabel[c.value as keyof typeof intentLabel] ?? c.value}`;
    case "sentiment":
      return `sentiment is ${sentimentLabel[c.value as keyof typeof sentimentLabel] ?? c.value}`;
    case "channelType":
      return `channel is ${channelLabel[c.value as keyof typeof channelLabel] ?? c.value}`;
    case "leadScoreGte":
      return `lead score ≥ ${c.value}`;
    case "messageContains":
      return `message contains “${c.value}”`;
  }
}
function describeAction(a: Action, tags: Opt[], members: Opt[]): string {
  switch (a.type) {
    case "add_tag":
      return `add tag “${tags.find((t) => t.id === a.tagId)?.name ?? "?"}”`;
    case "set_priority":
      return `set priority ${priorityLabel[a.priority as keyof typeof priorityLabel] ?? a.priority}`;
    case "assign":
      return `assign to ${members.find((m) => m.id === a.userId)?.name ?? "?"}`;
    case "create_task":
      return `create task “${a.title}”`;
  }
}

export function AutomationCard({
  slug,
  automation,
  tags,
  members,
  canManage,
}: {
  slug: string;
  automation: AutomationCardData;
  tags: Opt[];
  members: Opt[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const triggerLabel = TRIGGERS.find((t) => t.value === automation.trigger)?.label ?? automation.trigger;

  function toggle() {
    startTransition(async () => {
      const res = await toggleAutomationAction(slug, automation.id, !automation.enabled);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }
  function remove() {
    if (!confirm("Delete this automation?")) return;
    startTransition(async () => {
      const res = await deleteAutomationAction(slug, automation.id);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }
  function runNow() {
    startTransition(async () => {
      const res = await runAutomationNowAction(slug, automation.id);
      if (res.ok) {
        alert(`Applied to ${res.affected} conversation(s).`);
        router.refresh();
      } else alert(res.error);
    });
  }

  const edit: EditableAutomation = {
    id: automation.id,
    name: automation.name,
    trigger: automation.trigger,
    conditions: automation.conditions,
    actions: automation.actions,
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Zap className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{automation.name}</h3>
              <Badge variant={automation.enabled ? "success" : "default"}>
                {automation.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{triggerLabel}</p>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-0.5">
            <button onClick={() => setEditOpen(true)} className="rounded p-1.5 text-muted-foreground hover:bg-muted" title="Edit">
              <Pencil className="size-3.5" />
            </button>
            <button onClick={remove} disabled={pending} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-danger" title="Delete">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <div>
          <span className="font-medium text-muted-foreground">If </span>
          {automation.conditions.length === 0 ? (
            <span>any conversation</span>
          ) : (
            automation.conditions.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="text-muted-foreground"> and </span>}
                <span className="rounded bg-muted px-1.5 py-0.5">{describeCondition(c, tags)}</span>
              </span>
            ))
          )}
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Then </span>
          {automation.actions.map((a, i) => (
            <span key={i}>
              {i > 0 && <span className="text-muted-foreground">, </span>}
              <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">
                {describeAction(a, tags, members)}
              </span>
            </span>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={toggle} disabled={pending}>
            {automation.enabled ? "Disable" : "Enable"}
          </Button>
          <Button variant="ghost" size="sm" onClick={runNow} disabled={pending}>
            <Play className="size-3.5" /> Run now
          </Button>
          {automation.lastRunAt && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              Last run {relativeTime(automation.lastRunAt)}
            </span>
          )}
        </div>
      )}

      <AutomationDialog
        slug={slug}
        tags={tags}
        members={members}
        open={editOpen}
        onOpenChange={setEditOpen}
        automation={edit}
      />
    </div>
  );
}
