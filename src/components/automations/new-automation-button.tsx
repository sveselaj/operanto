"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutomationDialog, type Opt } from "@/components/automations/automation-dialog";

export function NewAutomationButton({
  slug,
  tags,
  members,
}: {
  slug: string;
  tags: Opt[];
  members: Opt[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New automation
      </Button>
      <AutomationDialog slug={slug} tags={tags} members={members} open={open} onOpenChange={setOpen} />
    </>
  );
}
