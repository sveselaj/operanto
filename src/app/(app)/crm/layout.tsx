import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { crmEnabled } from "@/lib/crm-flag";

/**
 * CRM gate (OI-3): server-side flag first (404 when the deployment has the
 * CRM disabled — the area does not exist), then permission. Server Actions in
 * this tree re-check both; the layout only guards rendering.
 */
export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!crmEnabled()) notFound();
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "crm.view")) redirect("/dashboard");
  return <>{children}</>;
}
