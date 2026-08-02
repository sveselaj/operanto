import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Membership, Organisation, User } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Multi-tenancy boundary.
 *
 * Every protected operation resolves the CURRENT membership from the database
 * (never from the JWT), so suspensions, role changes, and session revocation
 * take effect immediately. The returned organisation id must be threaded into
 * every Prisma query (see `scope`).
 *
 * The active organisation for users with several memberships is chosen via the
 * `operanto-org` cookie; the cookie only selects among memberships that are
 * verified ACTIVE on this request — it can never grant access.
 */

export const ORG_COOKIE = "operanto-org";

export type OrgContext = {
  organisation: Organisation;
  membership: Membership;
  user: Pick<User, "id" | "name" | "email">;
};

/** Session with immediate revocation + user status enforcement. Null if invalid. */
export const getAuthenticatedUser = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE") return null;
  if (
    user.sessionsRevokedAt &&
    session.user.tokenIssuedAt * 1000 < user.sessionsRevokedAt.getTime()
  ) {
    return null;
  }
  return user;
});

const activeMemberships = cache(async (userId: string) => {
  return prisma.membership.findMany({
    where: { userId, status: "ACTIVE", organisation: { status: "ACTIVE" } },
    include: { organisation: true },
    orderBy: { createdAt: "asc" },
  });
});

/**
 * Resolve the caller's organisation context without redirecting. Returns null
 * when unauthenticated, revoked, suspended, or without an active membership.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const memberships = await activeMemberships(user.id);
  if (memberships.length === 0) return null;

  const requested = (await cookies()).get(ORG_COOKIE)?.value;
  const selected =
    memberships.find((m) => m.organisationId === requested) ?? memberships[0];

  const { organisation, ...membership } = selected;
  return {
    organisation,
    membership,
    user: { id: user.id, name: user.name, email: user.email },
  };
});

/**
 * Resolve the org context or redirect to /login, and refuse privileged roles
 * that have not enrolled a second factor.
 *
 * Enforcement lives here, not in a layout: a layout guards rendering, while
 * every Server Action is a public POST endpoint that never runs it. Since
 * every action already calls requireOrg, this is the one place that covers
 * both.
 */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const ctx = await requireOrgAllowingEnrolment();
  if (await twoFactorEnrolmentOutstanding(ctx)) redirect("/two-factor");
  return ctx;
});

/**
 * The same check WITHOUT the two-factor gate — for the enrolment screen and
 * its actions only, which would otherwise redirect to themselves forever.
 */
export const requireOrgAllowingEnrolment = cache(async (): Promise<OrgContext> => {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  return ctx;
});

/** True when this membership's role requires a second factor and none is active. */
export async function twoFactorEnrolmentOutstanding(
  ctx: OrgContext,
): Promise<boolean> {
  const { roleRequiresTwoFactor } = await import("@/lib/services/two-factor");
  if (!roleRequiresTwoFactor(ctx.membership.role)) return false;
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { totpConfirmedAt: true },
  });
  return !user?.totpConfirmedAt;
}

/** List of active memberships for the org switcher. */
export const listMyOrganisations = cache(async () => {
  const user = await getAuthenticatedUser();
  if (!user) return [];
  return activeMemberships(user.id);
});

/**
 * Tenant scope helper — spread into every Prisma `where`:
 *   prisma.opportunity.findMany({ where: { ...scope(ctx), stage: "NEW" } })
 */
export function scope(ctx: OrgContext) {
  return { organisationId: ctx.organisation.id };
}
