import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { getTargetProfile } from "@/lib/services/growth/profiles";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setProfileStatusAction } from "../../actions";
import { ProfileForm } from "../profile-form";

export const metadata: Metadata = { title: "Target Profile" };

// Mirrors the server-side profile machine exactly (ARCHIVED is terminal).
const NEXT_STATUSES: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

export default async function TargetProfileDetailPage({
  params,
}: PageProps<"/growth/target-profiles/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const profile = await getTargetProfile(ctx, id);
  if (!profile) notFound();
  const canManage = can(ctx.membership.role, "growth:manage_target_profiles");

  return (
    <>
      <PageHeader
        title={profile.name}
        description={`${profile._count.accounts} linked account${profile._count.accounts === 1 ? "" : "s"} · activating never triggers research or outreach`}
      >
        <div className="flex items-center gap-2">
          <Badge variant={profile.status === "ACTIVE" ? "default" : "outline"}>
            {profile.status.toLowerCase()}
          </Badge>
          {canManage
            ? NEXT_STATUSES[profile.status]?.map((status) => (
                <form key={status} action={setProfileStatusAction}>
                  <input type="hidden" name="profileId" value={profile.id} />
                  <input type="hidden" name="status" value={status} />
                  <Button type="submit" variant="outline" size="sm">
                    {status === "ACTIVE"
                      ? "Activate"
                      : status === "PAUSED"
                        ? "Pause"
                        : "Archive"}
                  </Button>
                </form>
              ))
            : null}
        </div>
      </PageHeader>
      {canManage ? (
        <ProfileForm
          initial={{
            id: profile.id,
            name: profile.name,
            description: profile.description ?? "",
            industries: profile.industries.join(", "),
            regions: profile.regions.join(", "),
            companySizeMin: profile.companySizeMin?.toString() ?? "",
            companySizeMax: profile.companySizeMax?.toString() ?? "",
            characteristics: profile.characteristics.join(", "),
            decisionMakerRoles: profile.decisionMakerRoles.join(", "),
            positiveSignals: profile.positiveSignals.join(", "),
            negativeSignals: profile.negativeSignals.join(", "),
            exclusionCriteria: profile.exclusionCriteria.join(", "),
            operantoUseCases: profile.operantoUseCases.join(", "),
            languages: profile.languages.join(", "),
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          You can view this profile but not edit it.
        </p>
      )}
    </>
  );
}
