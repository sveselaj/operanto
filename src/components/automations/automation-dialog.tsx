"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Intent, Sentiment, ChannelType, Priority, type AutomationTrigger } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { intentLabel, sentimentLabel, channelLabel, priorityLabel } from "@/lib/labels";
import {
  CONDITION_FIELDS,
  ACTION_TYPES,
  TRIGGERS,
  type Condition,
  type Action,
} from "@/lib/automations/schema";
import {
  createAutomationAction,
  updateAutomationAction,
} from "@/app/[workspace]/automations/actions";

export type Opt = { id: string; name: string };

const intents = Object.values(Intent);
const sentiments = Object.values(Sentiment);
const channels = Object.values(ChannelType);
const priorities = Object.values(Priority);

const selectCls =
  "h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function defaultCondition(field: Condition["field"]): Condition {
  switch (field) {
    case "intent":
      return { field, value: intents[0] };
    case "sentiment":
      return { field, value: sentiments[0] };
    case "channelType":
      return { field, value: channels[0] };
    case "leadScoreGte":
      return { field, value: 70 };
    case "messageContains":
      return { field, value: "" };
  }
}

function defaultAction(type: Action["type"], tags: Opt[], members: Opt[]): Action {
  switch (type) {
    case "add_tag":
      return { type, tagId: tags[0]?.id ?? "" };
    case "set_priority":
      return { type, priority: "high" };
    case "assign":
      return { type, userId: members[0]?.id ?? "" };
    case "create_task":
      return { type, title: "Follow up" };
  }
}

export type EditableAutomation = {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
};

export function AutomationDialog({
  slug,
  tags,
  members,
  open,
  onOpenChange,
  automation,
}: {
  slug: string;
  tags: Opt[];
  members: Opt[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  automation?: EditableAutomation;
}) {
  const router = useRouter();
  const editing = !!automation;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(automation?.name ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    automation?.trigger ?? "conversation_analyzed",
  );
  const [conditions, setConditions] = useState<Condition[]>(automation?.conditions ?? []);
  const [actions, setActions] = useState<Action[]>(
    automation?.actions ?? [defaultAction("add_tag", tags, members)],
  );

  function setCondition(i: number, c: Condition) {
    setConditions((prev) => prev.map((x, idx) => (idx === i ? c : x)));
  }
  function setAction(i: number, a: Action) {
    setActions((prev) => prev.map((x, idx) => (idx === i ? a : x)));
  }

  function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (actions.length === 0) {
      setError("Add at least one action.");
      return;
    }
    setError(null);
    const fields = { name, trigger, conditions, actions };
    startTransition(async () => {
      const res = editing
        ? await updateAutomationAction(slug, automation!.id, fields)
        : await createAutomationAction(slug, fields);
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
          <DialogTitle>{editing ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>Run actions automatically when conditions match.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Trigger</Label>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
              className={`${selectCls} w-full`}
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Conditions */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="mb-0">Conditions (all must match)</Label>
              <button
                type="button"
                onClick={() => setConditions((p) => [...p, defaultCondition("intent")])}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="size-3" /> Add condition
              </button>
            </div>
            {conditions.length === 0 && (
              <p className="text-xs text-muted-foreground">No conditions — matches every conversation.</p>
            )}
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => setCondition(i, defaultCondition(e.target.value as Condition["field"]))}
                    className={selectCls}
                  >
                    {CONDITION_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <ConditionValue c={c} onChange={(v) => setCondition(i, v)} />
                  <button
                    type="button"
                    onClick={() => setConditions((p) => p.filter((_, idx) => idx !== i))}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="mb-0">Actions</Label>
              <button
                type="button"
                onClick={() => setActions((p) => [...p, defaultAction("add_tag", tags, members)])}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="size-3" /> Add action
              </button>
            </div>
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={a.type}
                    onChange={(e) =>
                      setAction(i, defaultAction(e.target.value as Action["type"], tags, members))
                    }
                    className={selectCls}
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <ActionParam a={a} tags={tags} members={members} onChange={(v) => setAction(i, v)} />
                  <button
                    type="button"
                    onClick={() => setActions((p) => p.filter((_, idx) => idx !== i))}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save" : "Create automation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConditionValue({ c, onChange }: { c: Condition; onChange: (v: Condition) => void }) {
  if (c.field === "intent")
    return (
      <select value={c.value} onChange={(e) => onChange({ field: "intent", value: e.target.value })} className={`${selectCls} flex-1`}>
        {intents.map((v) => (
          <option key={v} value={v}>
            {intentLabel[v]}
          </option>
        ))}
      </select>
    );
  if (c.field === "sentiment")
    return (
      <select value={c.value} onChange={(e) => onChange({ field: "sentiment", value: e.target.value })} className={`${selectCls} flex-1`}>
        {sentiments.map((v) => (
          <option key={v} value={v}>
            {sentimentLabel[v]}
          </option>
        ))}
      </select>
    );
  if (c.field === "channelType")
    return (
      <select value={c.value} onChange={(e) => onChange({ field: "channelType", value: e.target.value })} className={`${selectCls} flex-1`}>
        {channels.map((v) => (
          <option key={v} value={v}>
            {channelLabel[v]}
          </option>
        ))}
      </select>
    );
  if (c.field === "leadScoreGte")
    return (
      <Input
        type="number"
        min={0}
        max={100}
        value={c.value}
        onChange={(e) => onChange({ field: "leadScoreGte", value: Number(e.target.value) })}
        className="flex-1"
      />
    );
  return (
    <Input
      value={c.value}
      placeholder="text to match"
      onChange={(e) => onChange({ field: "messageContains", value: e.target.value })}
      className="flex-1"
    />
  );
}

function ActionParam({
  a,
  tags,
  members,
  onChange,
}: {
  a: Action;
  tags: Opt[];
  members: Opt[];
  onChange: (v: Action) => void;
}) {
  if (a.type === "add_tag")
    return (
      <select value={a.tagId} onChange={(e) => onChange({ type: "add_tag", tagId: e.target.value })} className={`${selectCls} flex-1`}>
        {tags.length === 0 && <option value="">No tags</option>}
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    );
  if (a.type === "set_priority")
    return (
      <select value={a.priority} onChange={(e) => onChange({ type: "set_priority", priority: e.target.value as Priority })} className={`${selectCls} flex-1`}>
        {priorities.map((p) => (
          <option key={p} value={p}>
            {priorityLabel[p]}
          </option>
        ))}
      </select>
    );
  if (a.type === "assign")
    return (
      <select value={a.userId} onChange={(e) => onChange({ type: "assign", userId: e.target.value })} className={`${selectCls} flex-1`}>
        {members.length === 0 && <option value="">No members</option>}
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    );
  return (
    <Input
      value={a.title}
      placeholder="Task title"
      onChange={(e) => onChange({ type: "create_task", title: e.target.value })}
      className="flex-1"
    />
  );
}
