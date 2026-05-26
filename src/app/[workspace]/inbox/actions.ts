"use server";

import { revalidatePath } from "next/cache";
import type { ConversationStatus, Priority } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as conversations from "@/lib/services/conversations";
import * as aiInbox from "@/lib/services/ai-inbox";
import type { DraftReplyOutput } from "@/lib/ai/tasks";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function ctxOrThrow(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx) throw new Error("Not authorized for this workspace");
  return ctx;
}

function toResult(fn: () => Promise<unknown>, slug: string, convId?: string) {
  return fn()
    .then(() => {
      revalidatePath(`/${slug}/inbox`);
      if (convId) revalidatePath(`/${slug}/inbox/${convId}`);
      return { ok: true } as ActionResult;
    })
    .catch((e: unknown) => {
      const error =
        e instanceof ForbiddenError
          ? "You don't have permission to do that."
          : e instanceof Error
            ? e.message
            : "Something went wrong.";
      return { ok: false, error } as ActionResult;
    });
}

export async function sendReplyAction(
  slug: string,
  conversationId: string,
  body: string,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await conversations.sendReply(ctx, conversationId, body);
    },
    slug,
    conversationId,
  );
}

export async function updateStatusAction(
  slug: string,
  conversationId: string,
  status: ConversationStatus,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await conversations.updateStatus(ctx, conversationId, status);
    },
    slug,
    conversationId,
  );
}

export async function updatePriorityAction(
  slug: string,
  conversationId: string,
  priority: Priority,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await conversations.updatePriority(ctx, conversationId, priority);
    },
    slug,
    conversationId,
  );
}

export async function assignConversationAction(
  slug: string,
  conversationId: string,
  userId: string | null,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await conversations.assignConversation(ctx, conversationId, userId);
    },
    slug,
    conversationId,
  );
}

export async function addNoteAction(
  slug: string,
  conversationId: string,
  body: string,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await conversations.addNote(ctx, conversationId, body);
    },
    slug,
    conversationId,
  );
}

export async function setTagsAction(
  slug: string,
  conversationId: string,
  tagIds: string[],
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await conversations.setTags(ctx, conversationId, tagIds);
    },
    slug,
    conversationId,
  );
}

// ── AI actions ────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  if (e instanceof ForbiddenError) return "You don't have permission to do that.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Summarize + classify, persisting derived fields. Refreshes the detail view. */
export async function analyzeConversationAction(
  slug: string,
  conversationId: string,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await aiInbox.analyzeConversation(ctx, conversationId);
    },
    slug,
    conversationId,
  );
}

export type DraftResult =
  | { ok: true; draft: DraftReplyOutput }
  | { ok: false; error: string };

/** Produce an AI reply draft for the agent to edit. Never sends. */
export async function aiDraftReplyAction(
  slug: string,
  conversationId: string,
  instruction?: string,
): Promise<DraftResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const draft = await aiInbox.draftConversationReply(ctx, conversationId, instruction);
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
