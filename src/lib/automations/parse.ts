import { conditionSchema, actionSchema, type Condition, type Action } from "@/lib/automations/schema";

/** Safely parse persisted JSON into typed conditions/actions, dropping invalid entries. */
export function parseConditionsSafe(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const p = conditionSchema.safeParse(c);
    return p.success ? [p.data] : [];
  });
}

export function parseActionsSafe(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) => {
    const p = actionSchema.safeParse(a);
    return p.success ? [p.data] : [];
  });
}
