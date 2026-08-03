import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg, scope } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import accounts" };

export default async function ImportAccountsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "growth:import_accounts")) redirect("/growth/accounts");
  const activeProfiles = await prisma.targetProfile.findMany({
    where: { ...scope(ctx), status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader
        title="Import accounts"
        description="Preview, map and validate before anything is written. No URLs are fetched and no research runs during import."
      />
      <ImportWizard activeProfiles={activeProfiles} />
    </>
  );
}
