"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAccountAction, type FormState } from "../../actions";

type AccountValues = {
  id: string;
  name: string;
  tradingName: string;
  domain: string;
  website: string;
  industry: string;
  description: string;
  country: string;
  region: string;
  city: string;
  employeeEstimate: string;
  phone: string;
  publicEmail: string;
  targetProfileId: string;
};

const FIELDS: { name: keyof AccountValues; label: string }[] = [
  { name: "name", label: "Name" },
  { name: "tradingName", label: "Trading name" },
  { name: "domain", label: "Domain" },
  { name: "website", label: "Website" },
  { name: "industry", label: "Industry" },
  { name: "country", label: "Country (ISO-2)" },
  { name: "region", label: "Region" },
  { name: "city", label: "City" },
  { name: "employeeEstimate", label: "Employee estimate" },
  { name: "phone", label: "Phone" },
  { name: "publicEmail", label: "Public email" },
];

export function AccountEditForm({
  account,
  profiles,
}: {
  account: AccountValues;
  profiles: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateAccountAction,
    null,
  );

  if (!editing) {
    return (
      <div className="space-y-2 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {FIELDS.map((field) => (
            <div key={field.name} className="contents">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd>{account[field.name] || "—"}</dd>
            </div>
          ))}
        </dl>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit details
        </Button>
        {state && !state.error ? (
          <p className="text-xs text-muted-foreground">Saved.</p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="accountId" value={account.id} />
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <div key={field.name}>
            <label className="mb-1 block text-xs font-medium" htmlFor={`acc-${field.name}`}>
              {field.label}
            </label>
            <Input
              id={`acc-${field.name}`}
              name={field.name}
              defaultValue={account[field.name]}
              required={field.name === "name"}
            />
          </div>
        ))}
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="acc-profile">
            Target profile
          </label>
          <select
            id="acc-profile"
            name="targetProfileId"
            defaultValue={account.targetProfileId}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">No profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="acc-description">
          Description
        </label>
        <textarea
          id="acc-description"
          name="description"
          rows={2}
          defaultValue={account.description}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {state?.error ? (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
