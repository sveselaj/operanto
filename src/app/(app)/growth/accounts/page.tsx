import type { Metadata } from "next";
import Link from "next/link";
import type { GrowthAccountStatus } from "@prisma/client";
import { requireOrg, scope } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { listGrowthAccountsPage } from "@/lib/services/growth/accounts";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Growth Accounts" };

const STATUSES: GrowthAccountStatus[] = [
  "IMPORTED",
  "NEEDS_REVIEW",
  "READY_FOR_RESEARCH",
  "REJECTED",
  "SUPPRESSED",
];

export default async function GrowthAccountsPage({
  searchParams,
}: PageProps<"/growth/accounts">) {
  const ctx = await requireOrg();
  const params = await searchParams;
  const filter = {
    status: STATUSES.includes(params.status as GrowthAccountStatus)
      ? (params.status as GrowthAccountStatus)
      : undefined,
    targetProfileId: typeof params.profile === "string" ? params.profile : undefined,
    country: typeof params.country === "string" ? params.country : undefined,
    duplicatesOnly: params.duplicates === "1",
    search: typeof params.q === "string" ? params.q : undefined,
    page: typeof params.page === "string" ? Number(params.page) || 1 : 1,
  };
  const [{ total, page, pageSize, accounts }, profiles] = await Promise.all([
    listGrowthAccountsPage(ctx, filter),
    prisma.targetProfile.findMany({
      where: scope(ctx),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const canImport = can(ctx.membership.role, "growth:import_accounts");

  const query = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...over })) {
      if (typeof value === "string" && value) next.set(key, value);
    }
    return `/growth/accounts?${next.toString()}`;
  };

  return (
    <>
      <PageHeader title="Accounts" description={`${total} prospect account${total === 1 ? "" : "s"} in this organisation.`}>
        {canImport ? (
          <Link href="/growth/accounts/import">
            <Button size="sm">Import CSV</Button>
          </Link>
        ) : null}
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={filter.search ?? ""}
          placeholder="Search name or domain…"
          aria-label="Search accounts"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
        <select
          name="status"
          defaultValue={filter.status ?? ""}
          aria-label="Status filter"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.toLowerCase().replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          name="profile"
          defaultValue={filter.targetProfileId ?? ""}
          aria-label="Profile filter"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All profiles</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="duplicates" value="1" defaultChecked={filter.duplicatesOnly} />
          Duplicates only
        </label>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </form>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts match. Import a CSV to get started.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <Link
                  href={`/growth/accounts/${account.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {account.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {account.domainNormalized ?? "no domain"} ·{" "}
                  {account.country ?? "—"} ·{" "}
                  {account.targetProfile?.name ?? "no profile"} · imported{" "}
                  {formatDateTime(account.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {account.sources.length > 0 ? (
                  <Badge variant="outline">duplicate candidate</Badge>
                ) : null}
                <Badge
                  variant={account.status === "SUPPRESSED" ? "danger" : "outline"}
                >
                  {account.status.toLowerCase().replace(/_/g, " ")}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 ? (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 ? (
            <Link className="text-primary hover:underline" href={query({ page: String(page - 1) })}>
              ← Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link className="text-primary hover:underline" href={query({ page: String(page + 1) })}>
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
