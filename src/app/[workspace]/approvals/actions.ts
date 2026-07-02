"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import {
  approveInvocation,
  rejectInvocation,
  updateInvocationInput,
} from "@/lib/tools/runtime";

export type ActionResult = { ok: true } | { ok: false; error: string };

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
  revalidatePath(`/${slug}/approvals`);
  revalidatePath(`/${slug}/assistant`, "layout");
}

export async function approveInvocationAction(
  slug: string,
  invocationId: string,
  reviewNote?: string,
): Promise<ActionResult & { executed?: boolean; error?: string }> {
  try {
    const ctx = await ctxOrThrow(slug);
    const res = await approveInvocation(ctx, invocationId, { reviewNote });
    revalidate(slug);
    if (res.error) return { ok: false, error: `Approved, but execution failed: ${res.error}` };
    return { ok: true, executed: res.executed };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function rejectInvocationAction(
  slug: string,
  invocationId: string,
  reviewNote?: string,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await rejectInvocation(ctx, invocationId, { reviewNote });
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function editApprovalAction(
  slug: string,
  invocationId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await updateInvocationInput(ctx, invocationId, patch);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
