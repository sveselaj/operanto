import "server-only";
import type { PropertyStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";

export async function listProperties(
  ctx: WorkspaceContext,
  filters: { status?: PropertyStatus; city?: string } = {},
) {
  requirePermission(ctx.member.role, "properties:read");
  return prisma.property.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {}),
    },
    include: { assignedAgent: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { price: "asc" }],
    take: 200,
  });
}
