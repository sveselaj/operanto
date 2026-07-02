import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";

/**
 * Structured context for a customer conversation shown in the cockpit's right
 * panel. Vertical-agnostic: it surfaces the linked opportunity and any context
 * links (e.g. a property reference) but never imports a vertical entity —
 * authoritative facts like property availability come from tools on demand.
 */
export async function getConversationContext(ctx: WorkspaceContext, conversationId: string) {
  requirePermission(ctx.member.role, "conversations:read");
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspace.id },
    include: {
      customer: true,
      channelAccount: { select: { name: true } },
      assignedTo: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100,
        include: { sender: { select: { name: true } } },
      },
      internalNotes: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { name: true } } },
      },
      contextLinks: true,
      tasks: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!conversation) throw new Error("Conversation not found");

  const oppLinkIds = conversation.contextLinks
    .filter((l) => l.recordType === "opportunity")
    .map((l) => l.recordId);
  const opportunity = await prisma.opportunity.findFirst({
    where: {
      workspaceId: ctx.workspace.id,
      OR: [{ conversationId }, ...(oppLinkIds.length ? [{ id: { in: oppLinkIds } }] : [])],
    },
    include: { owner: { select: { name: true } }, contact: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const propertyLinks = conversation.contextLinks.filter((l) => l.recordType === "property");

  return { conversation, opportunity, propertyLinks };
}
