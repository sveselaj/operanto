"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as approvals from "@/lib/services/approvals";

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
function toResult(fn: () => Promise<unknown>, slug: string): Promise<ActionResult> {
  return fn()
    .then(() => {
      revalidatePath(`/${slug}/approvals`);
      return { ok: true } as ActionResult;
    })
    .catch((e: unknown) => ({ ok: false, error: errorMessage(e) }) as ActionResult);
}

export async function decideApprovalAction(
  slug: string,
  id: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await approvals.decideApproval(ctx, id, decision, note);
  }, slug);
}

export async function cancelApprovalAction(slug: string, id: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await approvals.cancelApproval(ctx, id);
  }, slug);
}
