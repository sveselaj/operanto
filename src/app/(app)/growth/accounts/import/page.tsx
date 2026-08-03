import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import accounts" };

export default async function ImportAccountsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "growth:import_accounts")) redirect("/growth/accounts");
  return (
    <>
      <PageHeader
        title="Import accounts"
        description="Preview, map and validate before anything is written. No URLs are fetched and no research runs during import."
      />
      <ImportWizard />
    </>
  );
}
