"use server";

import { revalidatePath } from "next/cache";
import type { QuoteStatus, TaxMode } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as quotes from "@/lib/services/quotes";

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

function revalidateQuote(slug: string, opportunityId: string, quoteId?: string) {
  revalidatePath(`/${slug}/opportunities/${opportunityId}`);
  if (quoteId) revalidatePath(`/${slug}/opportunities/${opportunityId}/quotes/${quoteId}`);
}

export type CreateQuoteResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };

export async function createQuoteAction(slug: string, opportunityId: string): Promise<CreateQuoteResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const q = await quotes.createQuote(ctx, opportunityId);
    revalidateQuote(slug, opportunityId);
    return { ok: true, quoteId: q.id };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function draftQuoteAction(slug: string, opportunityId: string): Promise<CreateQuoteResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const q = await quotes.draftQuote(ctx, opportunityId);
    revalidateQuote(slug, opportunityId, q.id);
    return { ok: true, quoteId: q.id };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function addLineAction(
  slug: string,
  opportunityId: string,
  quoteId: string,
  input: { productId?: string | null; description: string; quantity: number; unitPrice: number; discount?: number; taxRate?: number },
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await quotes.addLine(ctx, quoteId, input);
    revalidateQuote(slug, opportunityId, quoteId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateLineAction(
  slug: string,
  opportunityId: string,
  quoteId: string,
  lineId: string,
  patch: { description?: string; quantity?: number; unitPrice?: number; discount?: number; taxRate?: number },
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await quotes.updateLine(ctx, lineId, patch);
    revalidateQuote(slug, opportunityId, quoteId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function removeLineAction(
  slug: string,
  opportunityId: string,
  quoteId: string,
  lineId: string,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await quotes.removeLine(ctx, lineId);
    revalidateQuote(slug, opportunityId, quoteId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateQuoteAction(
  slug: string,
  opportunityId: string,
  quoteId: string,
  patch: { status?: QuoteStatus; notes?: string | null; validUntil?: string | null; taxMode?: TaxMode },
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await quotes.updateQuote(ctx, quoteId, patch);
    revalidateQuote(slug, opportunityId, quoteId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
