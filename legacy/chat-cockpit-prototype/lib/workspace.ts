import { cache } from "react";
import { redirect } from "next/navigation";
import type { WorkspaceMember, Workspace } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Multi-tenancy boundary.
 *
 * Every tenant-scoped server operation resolves the current user's membership
 * in a workspace through `requireWorkspace`. The returned `workspaceId` must be
 * threaded into every Prisma query (see `scope`). Cross-tenant access is
 * impossible because we never query tenant data without a resolved membership.
 */

export type WorkspaceContext = {
  workspace: Workspace;
  member: WorkspaceMember;
  userId: string;
};

/** Current authenticated user id, or redirect to login. */
export const requireUserId = cache(async (): Promise<string> => {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
});

/** All workspaces the current user belongs to (for the switcher / selection). */
export const listMyWorkspaces = cache(async () => {
  const userId = await requireUserId();
  return prisma.workspaceMember.findMany({
    where: { userId, status: "active" },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
});

/**
 * Resolve membership for a workspace slug without redirecting. Returns null if
 * unauthenticated or not an active member. Use in server actions / route
 * handlers where a redirect is inappropriate.
 */
export const getWorkspaceContext = cache(
  async (slug: string): Promise<WorkspaceContext | null> => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return null;

    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) return null;

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    });
    if (!member || member.status !== "active") return null;

    return { workspace, member, userId };
  },
);

/**
 * Resolve membership for a workspace slug. Redirects to login if unauthenticated
 * and to workspace selection if the user is not a member.
 */
export const requireWorkspace = cache(
  async (slug: string): Promise<WorkspaceContext> => {
    await requireUserId();
    const ctx = await getWorkspaceContext(slug);
    if (!ctx) redirect("/select-workspace");
    return ctx;
  },
);

/**
 * Tenant scope helper. Spread into any Prisma `where` to guarantee the query is
 * constrained to the active workspace.
 *
 *   prisma.conversation.findMany({ where: { ...scope(ctx), status: "open" } })
 */
export function scope(ctx: WorkspaceContext) {
  return { workspaceId: ctx.workspace.id };
}
