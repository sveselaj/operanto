import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { GrowthAccountStatus } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { getGrowthAccount } from "@/lib/services/growth/accounts";
import { canTransition } from "@/lib/services/growth/lifecycle";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  assignAccountAction,
  suppressAccountAction,
  transitionAccountAction,
} from "../../actions";
import { AccountEditForm } from "./account-edit-form";
import { prisma } from "@/lib/prisma";
import { scope } from "@/lib/org-context";

export const metadata: Metadata = { title: "Growth Account" };

/** G2 exposes only the pre-research part of the lifecycle. */
const G2_TARGETS: GrowthAccountStatus[] = [
  "NEEDS_REVIEW",
  "READY_FOR_RESEARCH",
  "REJECTED",
];

const TRANSITION_LABELS: Record<string, string> = {
  NEEDS_REVIEW: "Send to review",
  READY_FOR_RESEARCH: "Accept for research",
  REJECTED: "Reject",
};

export default async function GrowthAccountDetailPage({
  params,
  searchParams,
}: PageProps<"/growth/accounts/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const { error } = await searchParams;
  const account = await getGrowthAccount(ctx, id);
  if (!account) notFound();

  const canReview = can(ctx.membership.role, "growth:review_accounts");
  const canAssign = can(ctx.membership.role, "growth:assign_accounts");
  const canEdit = can(ctx.membership.role, "growth:edit_accounts");
  const [members, profiles] = await Promise.all([
    canAssign ? listAssignableMembers(ctx) : Promise.resolve([]),
    prisma.targetProfile.findMany({
      where: scope(ctx),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const transitions = G2_TARGETS.filter((to) => canTransition(account.status, to));
  const duplicateSources = account.sources.filter((s) => s.duplicateOfAccountId);

  return (
    <>
      <PageHeader
        title={account.name}
        description={`${account.domainNormalized ?? "no domain"} · ${account.country ?? "—"} · imported ${formatDateTime(account.createdAt)}`}
      >
        <div className="flex items-center gap-2">
          <Badge variant={account.status === "SUPPRESSED" ? "danger" : "default"}>
            {account.status.toLowerCase().replace(/_/g, " ")}
          </Badge>
          {canReview
            ? transitions.map((to) => (
                <form key={to} action={transitionAccountAction}>
                  <input type="hidden" name="accountId" value={account.id} />
                  <input type="hidden" name="to" value={to} />
                  <Button type="submit" variant="outline" size="sm">
                    {TRANSITION_LABELS[to]}
                  </Button>
                </form>
              ))
            : null}
          {canReview && canTransition(account.status, "SUPPRESSED") ? (
            <form action={suppressAccountAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <input type="hidden" name="reason" value="manual suppression from account page" />
              <Button type="submit" variant="outline" size="sm">
                Suppress
              </Button>
            </form>
          ) : null}
        </div>
      </PageHeader>

      {typeof error === "string" && error ? (
        <p role="alert" className="mb-4 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {account.suppressedAt ? (
        <p className="mb-4 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          Suppressed {formatDateTime(account.suppressedAt)} — excluded from all
          future Growth execution. Imports cannot reactivate this account.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Company</h2>
            {canEdit ? (
              <AccountEditForm
                account={{
                  id: account.id,
                  name: account.name,
                  tradingName: account.tradingName ?? "",
                  domain: account.domain ?? "",
                  website: account.website ?? "",
                  industry: account.industry ?? "",
                  description: account.description ?? "",
                  country: account.country ?? "",
                  region: account.region ?? "",
                  city: account.city ?? "",
                  employeeEstimate: account.employeeEstimate?.toString() ?? "",
                  phone: account.phone ?? "",
                  publicEmail: account.publicEmail ?? "",
                  targetProfileId: account.targetProfileId ?? "",
                }}
                profiles={profiles}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Industry</dt>
                <dd>{account.industry ?? "—"}</dd>
                <dt className="text-muted-foreground">City</dt>
                <dd>{account.city ?? "—"}</dd>
                <dt className="text-muted-foreground">Employees</dt>
                <dd>{account.employeeEstimate ?? "—"}</dd>
                <dt className="text-muted-foreground">Public email</dt>
                <dd>{account.publicEmail ?? "—"}</dd>
              </dl>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Contacts
            </h2>
            {account.contacts.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No contacts imported.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {account.contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className={contact.redactedAt ? "italic text-muted-foreground" : ""}>
                        {contact.redactedAt
                          ? "(erased contact)"
                          : `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
                            contact.email ||
                            "Unnamed contact"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {contact.redactedAt ? "personal data removed" : (contact.email ?? "no e-mail")}
                        {contact.role ? ` · ${contact.role}` : ""} · {contact.verificationStatus}
                      </p>
                    </div>
                    {contact.suppressedAt ? <Badge variant="danger">suppressed</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Timeline
            </h2>
            <div className="divide-y divide-border">
              {account.activities.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                account.activities.map((activity) => (
                  <div key={activity.id} className="px-4 py-2.5 text-sm">
                    <p>{activity.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.activityType} · {formatDateTime(activity.occurredAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Owner</h2>
            {canAssign ? (
              <form action={assignAccountAction} className="space-y-2">
                <input type="hidden" name="accountId" value={account.id} />
                <select
                  name="membershipId"
                  defaultValue={account.ownerMembershipId ?? ""}
                  aria-label="Account owner"
                  className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.name ?? member.user.email}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Save owner
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                {account.ownerMembershipId ? "Assigned" : "Unassigned"}
              </p>
            )}
          </section>

          {duplicateSources.length > 0 ? (
            <section className="rounded-lg border border-warning/50 bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Duplicate candidates</h2>
              <p className="text-xs text-muted-foreground">
                {duplicateSources.length} import row
                {duplicateSources.length === 1 ? "" : "s"} matched this account
                and were recorded as provenance instead of new records.
              </p>
            </section>
          ) : null}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Provenance</h2>
            <div className="space-y-2 text-xs text-muted-foreground">
              {account.sources.slice(0, 5).map((source) => (
                <p key={source.id}>
                  {source.provider} · {formatDateTime(source.importedAt)}
                </p>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Research</h2>
            <p className="text-sm text-muted-foreground">
              Research not yet run. Evidence collection and scoring arrive in a
              later Growth slice.
            </p>
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Outreach</h2>
            <p className="text-sm text-muted-foreground">
              Outreach drafting arrives in a later Growth slice, after human
              review of researched accounts.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
