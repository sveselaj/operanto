"use server";

import { revalidatePath } from "next/cache";
import type { ContentChannel, ContentStatus } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as content from "@/lib/services/content";
import * as brandVoices from "@/lib/services/brand-voices";

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
function revalidate(slug: string) {
  revalidatePath(`/${slug}/studio`);
}

// ── Content ───────────────────────────────────────────────────
export async function createContentAction(
  slug: string,
  fields: { title: string; channel: ContentChannel; content: string; brandVoiceId?: string | null },
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await content.createContent(ctx, fields);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function updateContentAction(
  slug: string,
  id: string,
  fields: {
    title?: string;
    channel?: ContentChannel;
    content?: string;
    status?: ContentStatus;
    brandVoiceId?: string | null;
  },
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await content.updateContent(ctx, id, fields);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function deleteContentAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await content.deleteContent(ctx, id);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function generateContentAction(
  slug: string,
  fields: { channel: ContentChannel; goal: string; brandVoiceId?: string | null },
): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const draft = await content.generateContentDraft(ctx, fields);
    revalidate(slug);
    return { ok: true, id: draft.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function generateFromConversationAction(
  slug: string,
  conversationId: string,
  channel: ContentChannel,
): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const draft = await content.generateFromConversation(ctx, conversationId, channel);
    revalidate(slug);
    revalidatePath(`/${slug}/inbox/${conversationId}`);
    return { ok: true, id: draft.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function generateFromInsightAction(
  slug: string,
  insightId: string,
  channel: ContentChannel,
): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const draft = await content.generateFromInsight(ctx, insightId, channel);
    revalidate(slug);
    revalidatePath(`/${slug}/command`);
    return { ok: true, id: draft.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

// ── Brand voices ──────────────────────────────────────────────
export type BrandVoiceFields = {
  name: string;
  description?: string;
  tone?: string;
  language?: string;
  dos: string[];
  donts: string[];
  examplePhrases: string[];
};

export async function createBrandVoiceAction(
  slug: string,
  fields: BrandVoiceFields,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await brandVoices.createBrandVoice(ctx, fields);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function updateBrandVoiceAction(
  slug: string,
  id: string,
  fields: BrandVoiceFields,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await brandVoices.updateBrandVoice(ctx, id, fields);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function deleteBrandVoiceAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await brandVoices.deleteBrandVoice(ctx, id);
    revalidate(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
