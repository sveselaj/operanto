"use client";

import { useState, useTransition } from "react";
import { Check, Circle, Pencil, X } from "lucide-react";
import type { RequirementStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setRequirementValueAction } from "@/app/[workspace]/opportunities/actions";

type Requirement = {
  id: string;
  key: string;
  label: string;
  valueType: string;
  value: string | null;
  status: RequirementStatus;
  required: boolean;
  confidence: number | null;
};

export function RequirementChecklist({
  slug,
  opportunityId,
  requirements,
  canEdit,
}: {
  slug: string;
  opportunityId: string;
  requirements: Requirement[];
  canEdit: boolean;
}) {
  if (requirements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No requirements yet. Use <span className="font-medium">Extract requirements</span> to pull
        them from the conversation.
      </p>
    );
  }
  return (
    <div className="divide-y divide-border">
      {requirements.map((r) => (
        <RequirementRow key={r.id} slug={slug} opportunityId={opportunityId} req={r} canEdit={canEdit} />
      ))}
    </div>
  );
}

function RequirementRow({
  slug,
  opportunityId,
  req,
  canEdit,
}: {
  slug: string;
  opportunityId: string;
  req: Requirement;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(req.value ?? "");
  const [pending, startTransition] = useTransition();
  const provided = req.status === "provided";

  function save(next: string | null) {
    startTransition(async () => {
      const res = await setRequirementValueAction(slug, opportunityId, req.id, next);
      if (res.ok) setEditing(false);
      else alert(res.error);
    });
  }

  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={provided ? "mt-0.5 text-success" : "mt-0.5 text-muted-foreground"}>
        {provided ? <Check className="size-4" /> : <Circle className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{req.label}</span>
          {req.required && <Badge variant="outline">required</Badge>}
          {!provided && <Badge variant="warning">missing</Badge>}
          {typeof req.confidence === "number" && req.confidence < 1 && provided && (
            <span className="text-[11px] text-muted-foreground">
              {Math.round(req.confidence * 100)}% conf.
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1 flex items-center gap-1.5">
            <Input
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(value);
                if (e.key === "Escape") setEditing(false);
              }}
              className="h-8 w-56"
            />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => save(value)}>
              <Check className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {req.value || <span className="italic">not provided yet</span>}
          </p>
        )}
      </div>
      {canEdit && !editing && (
        <button
          type="button"
          onClick={() => {
            setValue(req.value ?? "");
            setEditing(true);
          }}
          className="mt-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title="Edit value"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}
