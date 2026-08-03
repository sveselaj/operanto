import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { growthEnabled } from "@/lib/growth-flag";

/**
 * Growth gate: server-side flag first (404 when the deployment has Growth
 * disabled — the area does not exist), then permission. Server Actions in
 * this tree re-check both; the layout only guards rendering.
 */
export default async function GrowthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!growthEnabled()) notFound();
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "growth:view")) redirect("/dashboard");
  return <>{children}</>;
}
