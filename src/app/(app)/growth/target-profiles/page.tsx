import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { listTargetProfiles } from "@/lib/services/growth/profiles";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Target Profiles" };

export default async function TargetProfilesPage() {
  const ctx = await requireOrg();
  const profiles = await listTargetProfiles(ctx);

  return (
    <>
      <PageHeader
        title="Target Profiles"
        description="What kinds of companies this organisation wants to reach."
      >
        <Link href="/growth/target-profiles/new">
          <Button size="sm">New profile</Button>
        </Link>
      </PageHeader>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No target profiles yet. A profile defines the market, signals and
          exclusions that imported accounts are measured against.
        </p>
      ) : (
        <div className="max-w-3xl divide-y divide-border rounded-lg border border-border bg-card">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <div>
                <Link
                  href={`/growth/target-profiles/${profile.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {profile.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {profile.regions.join(", ") || "No regions"} ·{" "}
                  {profile._count.accounts} account
                  {profile._count.accounts === 1 ? "" : "s"}
                </p>
              </div>
              <Badge variant={profile.status === "ACTIVE" ? "default" : "outline"}>
                {profile.status.toLowerCase()}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
