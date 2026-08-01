"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createConversationAction,
  type CreateConversationResult,
} from "../actions";

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export function NewConversationForm({
  customers,
  members,
  selfMembershipId,
  canAssign,
}: {
  customers: { id: string; label: string }[];
  members: { id: string; label: string }[];
  selfMembershipId: string;
  canAssign: boolean;
}) {
  const [result, formAction, pending] = useActionState<
    CreateConversationResult,
    FormData
  >(createConversationAction, null);

  return (
    <form action={formAction} className="space-y-3">
      {customers.length > 0 ? (
        <label className="block text-sm">
          <span className="text-muted-foreground">Customer (optional)</span>
          <select
            name="customerId"
            defaultValue=""
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Not linked yet</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block text-sm">
        <span className="text-muted-foreground">
          Counterpart name (required when no customer is linked)
        </span>
        <Input name="counterpartName" placeholder="e.g. walk-in visitor" className="mt-1" />
      </label>

      <label className="block text-sm">
        <span className="text-muted-foreground">Subject</span>
        <Input name="subject" placeholder="What is this about?" className="mt-1" />
      </label>

      <label className="block text-sm">
        <span className="text-muted-foreground">Priority</span>
        <select
          name="priority"
          defaultValue="NORMAL"
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority.charAt(0) + priority.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-muted-foreground">Assign to</span>
        <select
          name="assignedMembershipId"
          defaultValue=""
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Unassigned</option>
          {canAssign ? (
            members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))
          ) : (
            <option value={selfMembershipId}>Me</option>
          )}
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-muted-foreground">First message (optional)</span>
        <Textarea
          name="initialMessage"
          rows={3}
          placeholder="What was said or written?"
          className="mt-1"
        />
      </label>

      {result?.error ? (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create conversation"}
      </Button>
    </form>
  );
}
