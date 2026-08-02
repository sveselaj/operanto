import "server-only";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { conversationAccessWhere } from "@/lib/services/conversations";
import { opportunityAccessWhere } from "@/lib/services/opportunities";
import { taskAccessWhere } from "@/lib/services/tasks";

/**
 * Customer context for the conversation cockpit (Slice 2): what the
 * organisation already knows about the person, so nobody asks a returning
 * customer to reintroduce themselves.
 *
 * Every section is filtered by the CALLER's record-level scope — an operator
 * sees the customer's prior conversations, opportunities, and tasks only to
 * the extent they could open each of them directly. The org-wide activity
 * timeline additionally requires `activity:view_all`.
 */
export async function getCustomerContext(
  ctx: OrgContext,
  customerId: string,
  options: { excludeConversationId?: string } = {},
) {
  requirePermission(ctx.membership.role, "conversations:view_assigned");

  const customer = await prisma.customer.findFirst({
    where: { ...scope(ctx), id: customerId },
    include: {
      channelIdentities: {
        orderBy: { createdAt: "asc" },
        take: 10,
      },
      consents: { orderBy: { channelType: "asc" }, take: 10 },
    },
  });
  if (!customer) return null;

  const [priorConversations, opportunities, openTasks, activities] =
    await Promise.all([
      prisma.conversation.findMany({
        where: {
          ...conversationAccessWhere(ctx),
          customerId: customer.id,
          ...(options.excludeConversationId
            ? { id: { not: options.excludeConversationId } }
            : {}),
        },
        select: {
          id: true,
          subject: true,
          status: true,
          channelType: true,
          lastMessageAt: true,
          createdAt: true,
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      prisma.opportunity.findMany({
        where: { ...opportunityAccessWhere(ctx), customerId: customer.id },
        select: {
          id: true,
          type: true,
          stage: true,
          summary: true,
          lastActivityAt: true,
        },
        orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      prisma.task.findMany({
        where: {
          ...taskAccessWhere(ctx),
          status: "OPEN",
          OR: [
            { opportunity: { customerId: customer.id } },
            { conversation: { customerId: customer.id } },
          ],
        },
        select: { id: true, title: true, dueAt: true, priority: true },
        orderBy: [{ dueAt: "asc" }],
        take: 5,
      }),
      can(ctx.membership.role, "activity:view_all")
        ? prisma.activity.findMany({
            where: { ...scope(ctx), customerId: customer.id },
            select: {
              id: true,
              activityType: true,
              summary: true,
              occurredAt: true,
            },
            orderBy: { occurredAt: "desc" },
            take: 8,
          })
        : Promise.resolve([]),
    ]);

  return { customer, priorConversations, opportunities, openTasks, activities };
}
