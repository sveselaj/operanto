"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createProfileAction, updateProfileAction, type FormState } from "../actions";

export type ProfileFormValues = {
  id?: string;
  name: string;
  description: string;
  industries: string;
  regions: string;
  companySizeMin: string;
  companySizeMax: string;
  characteristics: string;
  decisionMakerRoles: string;
  positiveSignals: string;
  negativeSignals: string;
  exclusionCriteria: string;
  operantoUseCases: string;
  languages: string;
};

const LIST_FIELDS: { name: keyof ProfileFormValues; label: string; hint: string }[] = [
  { name: "industries", label: "Industries", hint: "Comma-separated, e.g. windows, renovation" },
  { name: "regions", label: "Countries / regions", hint: "e.g. DE, AT, CH-de" },
  { name: "characteristics", label: "Company characteristics", hint: "e.g. multiple branches" },
  { name: "decisionMakerRoles", label: "Decision-maker roles", hint: "e.g. Geschäftsführer" },
  { name: "positiveSignals", label: "Positive signals", hint: "e.g. many reviews, hiring" },
  { name: "negativeSignals", label: "Negative signals", hint: "e.g. franchise HQ elsewhere" },
  { name: "exclusionCriteria", label: "Exclusion criteria", hint: "e.g. existing customers" },
  { name: "operantoUseCases", label: "Relevant Operanto use cases", hint: "e.g. unified inbox" },
  { name: "languages", label: "Languages", hint: "e.g. de, en" },
];

export function ProfileForm({ initial }: { initial?: ProfileFormValues }) {
  const action = initial?.id ? updateProfileAction : createProfileAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      {initial?.id ? <input type="hidden" name="profileId" value={initial.id} /> : null}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="profile-name">
          Profile name
        </label>
        <Input
          id="profile-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="DACH Window & Renovation Installers"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="profile-description">
          Description
        </label>
        <textarea
          id="profile-description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="profile-size-min">
            Employees (min)
          </label>
          <Input
            id="profile-size-min"
            name="companySizeMin"
            type="number"
            min={0}
            defaultValue={initial?.companySizeMin ?? ""}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="profile-size-max">
            Employees (max)
          </label>
          <Input
            id="profile-size-max"
            name="companySizeMax"
            type="number"
            min={0}
            defaultValue={initial?.companySizeMax ?? ""}
          />
        </div>
      </div>
      {LIST_FIELDS.map((field) => (
        <div key={field.name}>
          <label className="mb-1 block text-sm font-medium" htmlFor={`profile-${field.name}`}>
            {field.label}
          </label>
          <Input
            id={`profile-${field.name}`}
            name={field.name}
            defaultValue={initial?.[field.name] ?? ""}
            placeholder={field.hint}
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : initial?.id ? "Save profile" : "Create profile"}
        </Button>
        {state?.error ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}
        {initial?.id && state && !state.error ? (
          <p className="text-sm text-muted-foreground">Saved.</p>
        ) : null}
      </div>
    </form>
  );
}
