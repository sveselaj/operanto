"use server";

import { revalidatePath } from "next/cache";
import type { AutomationTrigger } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as automations from "@/lib/services/automations";
import type { Condition, Action } from "@/lib/automations/schema";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type RunResult = { ok: true; affected: number } | { ok: false; error: string };

function toError(e: unknown): string {
  if (e instanceof ForbiddenError) return "You don't have permission to do that.";
  return e instanceof Error ? e.message : "Something went wrong.";
}
async function ctxOrThrow(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx) throw new Error("Not authorized for this workspace");
  return ctx;
}
function revalidate(slug: string) {
  revalidatePath(`/${slug}/automations`);
}

export type AutomationFields = {
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
};

export async function createAutomationAction(
  slug: string,
  fields: AutomationFields,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await automations.createAutomation(ctx, fields);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function updateAutomationAction(
  slug: string,
  id: string,
  fields: AutomationFields,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await automations.updateAutomation(ctx, id, fields);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function toggleAutomationAction(
  slug: string,
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await automations.setAutomationEnabled(ctx, id, enabled);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function deleteAutomationAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await automations.deleteAutomation(ctx, id);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function runAutomationNowAction(slug: string, id: string): Promise<RunResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const affected = await automations.runAutomationNow(ctx, id);
    revalidate(slug);
    revalidatePath(`/${slug}/inbox`);
    return { ok: true, affected };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
