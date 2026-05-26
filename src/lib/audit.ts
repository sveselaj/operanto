import { prisma } from "@/lib/prisma";
import type { WorkspaceContext } from "@/lib/workspace";

/**
 * Write an audit row for a sensitive mutation. Fire-and-forget friendly, but
 * awaited by callers so failures surface in development.
 */
export async function audit(
  ctx: WorkspaceContext,
  params: {
    action: string;
    entity: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      before: (params.before ?? undefined) as object | undefined,
      after: (params.after ?? undefined) as object | undefined,
    },
  });
}
