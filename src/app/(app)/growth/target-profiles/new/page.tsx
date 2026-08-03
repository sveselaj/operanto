import type { Metadata } from "next";
import { requireOrg } from "@/lib/org-context";
import { requirePermission } from "@/lib/rbac";
import { PageHeader } from "@/components/app/page-header";
import { ProfileForm } from "../profile-form";

export const metadata: Metadata = { title: "New Target Profile" };

export default async function NewTargetProfilePage() {
  const ctx = await requireOrg();
  requirePermission(ctx.membership.role, "growth:manage_target_profiles");
  return (
    <>
      <PageHeader
        title="New Target Profile"
        description="Define the market before importing accounts. Activating a profile never triggers research or outreach."
      />
      <ProfileForm />
    </>
  );
}
