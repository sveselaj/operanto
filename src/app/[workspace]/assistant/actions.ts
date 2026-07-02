"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import {
  createThread,
  sendAssistantMessage,
  archiveThread,
  getOrCreateConversationThread,
} from "@/lib/services/assistant";

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

export async function createThreadAction(slug: string): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const thread = await createThread(ctx);
    revalidatePath(`/${slug}/assistant`, "layout");
    return { ok: true, id: thread.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function openConversationThreadAction(
  slug: string,
  conversationId: string,
): Promise<CreateResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const thread = await getOrCreateConversationThread(ctx, conversationId);
    return { ok: true, id: thread.id };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function sendMessageAction(
  slug: string,
  threadId: string,
  text: string,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await sendAssistantMessage(ctx, threadId, text);
    revalidatePath(`/${slug}/assistant/${threadId}`);
    revalidatePath(`/${slug}/assistant`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function archiveThreadAction(slug: string, threadId: string): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    await archiveThread(ctx, threadId);
    revalidatePath(`/${slug}/assistant`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
