import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";

/**
 * Customer reads. Operators only see customers connected to opportunities
 * assigned to them ("relevant customer records").
 */

function customerAccessWhere(ctx: OrgContext): Prisma.CustomerWhereInput {
  if (can(ctx.membership.role, "customers:view_all")) return scope(ctx);
  return {
    ...scope(ctx),
    opportunities: { some: { assignedMembershipId: ctx.membership.id } },
  };
}

export async function listCustomers(ctx: OrgContext, search?: string) {
  requirePermission(ctx.membership.role, "customers:view_assigned");
  return prisma.customer.findMany({
    where: {
      ...customerAccessWhere(ctx),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    include: { _count: { select: { opportunities: true } } },
    orderBy: [{ lastInteractionAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getCustomer(ctx: OrgContext, id: string) {
  requirePermission(ctx.membership.role, "customers:view_assigned");
  return prisma.customer.findFirst({
    where: { ...customerAccessWhere(ctx), id },
    include: {
      opportunities: {
        include: {
          properties: { include: { propertyContext: true } },
          assignee: { include: { user: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      },
      activities: { orderBy: { occurredAt: "desc" }, take: 100 },
    },
  });
}
