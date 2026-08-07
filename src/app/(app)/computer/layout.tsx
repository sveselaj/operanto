import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { computerGuideEnabled } from "@/lib/computer-flag";

/**
 * Computer workbench gate (C3): flag first — with guide mode (which itself
 * requires the C2 bridge flag) disabled the area does not exist — then
 * permission. There is deliberately NO navigation entry; the workbench is a
 * direct route while the capability matures ("no empty UI" rule). Server
 * actions in this tree re-check flags and permissions; the layout only
 * guards rendering.
 */
export default async function ComputerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!computerGuideEnabled()) notFound();
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "computer:read")) redirect("/dashboard");
  return <>{children}</>;
}
