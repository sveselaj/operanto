"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import { startWorkflow, advanceWorkflow } from "@/lib/services/workflow";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function ctxOrThrow(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx) throw new Error("Not authorized for this workspace");
  return ctx;
}
function errorMessage(e: unknown): string {
  if (e instanceof ForbiddenError) return "You don't have permission to do that.";
  return e instanceof Error ? e.message : "Something went wrong.";
}
function toResult(fn: () => Promise<unknown>, slug: string, opportunityId: string): Promise<ActionResult> {
  return fn()
    .then(() => {
      revalidatePath(`/${slug}/opportunities/${opportunityId}`);
      return { ok: true } as ActionResult;
    })
    .catch((e: unknown) => ({ ok: false, error: errorMessage(e) }) as ActionResult);
}

export async function startWorkflowAction(slug: string, opportunityId: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await startWorkflow(ctx, opportunityId);
  }, slug, opportunityId);
}

export async function advanceWorkflowAction(slug: string, opportunityId: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await advanceWorkflow(ctx, opportunityId);
  }, slug, opportunityId);
}
