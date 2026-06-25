import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";

/**
 * MediaSync — human takeover.
 *
 * A conversation is either AI-handled (automations may auto-reply when the
 * workspace enables autonomy) or human-handled. Taking over assigns the
 * conversation to the acting user and switches it to `human`; releasing hands
 * it back to AI. The reply path also flips to `human` automatically when an
 * agent sends a message.
 */

async function assertConversation(ctx: WorkspaceContext, id: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true, handling: true, assignedToUserId: true },
  });
  if (!conv) throw new Error("Conversation not found");
  return conv;
}

export async function takeOver(ctx: WorkspaceContext, conversationId: string): Promise<void> {
  requirePermission(ctx.member.role, "conversations:reply");
  const before = await assertConversation(ctx, conversationId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      handling: "human",
      takenOverByUserId: ctx.userId,
      takenOverAt: new Date(),
      // Pull it onto the acting agent if it was unassigned.
      assignedToUserId: before.assignedToUserId ?? ctx.userId,
    },
  });
  await audit(ctx, {
    action: "conversation.takeover",
    entity: "Conversation",
    entityId: conversationId,
    before: { handling: before.handling },
    after: { handling: "human" },
  });
}

export async function releaseToAi(ctx: WorkspaceContext, conversationId: string): Promise<void> {
  requirePermission(ctx.member.role, "conversations:reply");
  const before = await assertConversation(ctx, conversationId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { handling: "ai", takenOverByUserId: null, takenOverAt: null },
  });
  await audit(ctx, {
    action: "conversation.release",
    entity: "Conversation",
    entityId: conversationId,
    before: { handling: before.handling },
    after: { handling: "ai" },
  });
}
