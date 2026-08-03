import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg, scope } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Growth" };

export default async function GrowthOverviewPage() {
  const ctx = await requireOrg();
  const [profiles, activeProfiles, accounts, duplicateCandidates, previewedImports, recent] =
    await Promise.all([
      prisma.targetProfile.count({ where: scope(ctx) }),
      prisma.targetProfile.count({ where: { ...scope(ctx), status: "ACTIVE" } }),
      prisma.growthAccount.count({ where: scope(ctx) }),
      prisma.accountSourceRecord.count({
        where: { ...scope(ctx), duplicateOfAccountId: { not: null } },
      }),
      prisma.growthImport.count({ where: { ...scope(ctx), status: "PREVIEWED" } }),
      prisma.growthAccount.findMany({
        where: scope(ctx),
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, status: true, createdAt: true },
      }),
    ]);

  const stats = [
    { label: "Target profiles", value: profiles },
    { label: "Active profiles", value: activeProfiles },
    { label: "Imported accounts", value: accounts },
    { label: "Duplicate candidates", value: duplicateCandidates },
    { label: "Imports awaiting commit", value: previewedImports },
  ];

  return (
    <>
      <PageHeader
        title="Growth"
        description="Account intelligence and assisted outreach — configuration and imported accounts."
      />
      <div className="grid max-w-4xl gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-5">
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold">Recently imported accounts</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No accounts yet. Create a target profile, then import a CSV under
            Accounts.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {recent.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <Link
                  href={`/growth/accounts/${account.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {account.name}
                </Link>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  {formatDateTime(account.createdAt)}
                  <Badge variant="outline">{account.status.toLowerCase().replace(/_/g, " ")}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
