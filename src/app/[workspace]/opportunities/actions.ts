"use server";

import { revalidatePath } from "next/cache";
import type { OpportunityStatus } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as opportunities from "@/lib/services/opportunities";
import { extractRequirements, detectMissingInfo } from "@/lib/services/ai-opportunities";

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

function toResult(fn: () => Promise<unknown>, paths: string[]): Promise<ActionResult> {
  return fn()
    .then(() => {
      for (const p of paths) revalidatePath(p);
      return { ok: true } as ActionResult;
    })
    .catch((e: unknown) => ({ ok: false, error: errorMessage(e) }) as ActionResult);
}

// ── Promote from a conversation ────────────────────────────────

export type PromoteResult =
  | { ok: true; opportunityId: string; created: boolean }
  | { ok: false; error: string };

export async function promoteConversationAction(
  slug: string,
  conversationId: string,
): Promise<PromoteResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const res = await opportunities.promoteConversation(ctx, conversationId);
    revalidatePath(`/${slug}/inbox/${conversationId}`);
    revalidatePath(`/${slug}/opportunities`);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ── Opportunity mutations ──────────────────────────────────────

export async function updateOpportunityAction(
  slug: string,
  id: string,
  patch: { status?: OpportunityStatus; title?: string; value?: number | null; stage?: string | null },
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await opportunities.updateOpportunity(ctx, id, patch);
    },
    [`/${slug}/opportunities`, `/${slug}/opportunities/${id}`],
  );
}

export async function assignOpportunityAction(
  slug: string,
  id: string,
  userId: string | null,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await opportunities.assignOpportunity(ctx, id, userId);
    },
    [`/${slug}/opportunities`, `/${slug}/opportunities/${id}`],
  );
}

export async function setRequirementValueAction(
  slug: string,
  opportunityId: string,
  requirementId: string,
  value: string | null,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await opportunities.setRequirementValue(ctx, requirementId, value);
    },
    [`/${slug}/opportunities/${opportunityId}`],
  );
}

// ── AI ─────────────────────────────────────────────────────────

export async function extractRequirementsAction(
  slug: string,
  opportunityId: string,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await extractRequirements(ctx, opportunityId);
    },
    [`/${slug}/opportunities/${opportunityId}`],
  );
}

export type MissingInfoResult =
  | { ok: true; complete: boolean; missingLabels: string[]; message: string | null }
  | { ok: false; error: string };

export async function detectMissingInfoAction(
  slug: string,
  opportunityId: string,
): Promise<MissingInfoResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const res = await detectMissingInfo(ctx, opportunityId);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
