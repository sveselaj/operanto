"use server";

import { revalidatePath } from "next/cache";
import type { SopStatus } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as sops from "@/lib/services/sops";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function toError(e: unknown): string {
  if (e instanceof ForbiddenError) return "You don't have permission to do that.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

async function ctxOrThrow(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx) throw new Error("Not authorized for this workspace");
  return ctx;
}

function revalidate(slug: string, id?: string) {
  revalidatePath(`/${slug}/sops`);
  if (id) revalidatePath(`/${slug}/sops/${id}`);
}

export async function createSOPAction(
  slug: string,
  fields: { title: string; description?: string; body: string; category?: string },
): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const sop = await sops.createSOP(ctx, fields);
    revalidate(slug, sop.id);
    return { ok: true, id: sop.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function updateSOPAction(
  slug: string,
  id: string,
  fields: { title?: string; description?: string | null; body?: string; category?: string | null },
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await sops.updateSOP(ctx, id, fields);
    revalidate(slug, id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function setSOPStatusAction(
  slug: string,
  id: string,
  status: SopStatus,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await sops.setSOPStatus(ctx, id, status);
    revalidate(slug, id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function generateSOPAction(
  slug: string,
  fields: { topic: string; businessType?: string; desiredOutcome?: string },
): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const sop = await sops.generateSOPDraft(ctx, fields);
    revalidate(slug, sop.id);
    return { ok: true, id: sop.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
