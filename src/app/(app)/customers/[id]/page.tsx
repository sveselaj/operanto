import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { getCustomer } from "@/lib/services/customers";
import { PageHeader } from "@/components/app/page-header";
import { ActorBadge } from "@/components/app/actor-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatStage } from "@/lib/format";
import { ErasureForm } from "./privacy-panel";
import { setRestrictionAction } from "./actions";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({
  params,
}: PageProps<"/customers/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const customer = await getCustomer(ctx, id);
  if (!customer) notFound();
  const canManagePrivacy = can(ctx.membership.role, "privacy:manage");

  return (
    <>
      <PageHeader
        title={customer.name ?? "Unnamed customer"}
        description={`First seen ${formatDateTime(customer.firstInteractionAt)} · Last interaction ${formatDateTime(customer.lastInteractionAt)}`}
      />

      {customer.erasedAt ? (
        <p className="mb-4 rounded-md border border-border bg-muted px-4 py-2 text-sm">
          Personal data was erased on {formatDateTime(customer.erasedAt)}. What
          remains is a record that the inquiry existed — no personal data.
        </p>
      ) : null}
      {customer.restrictedAt ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          Processing is restricted since {formatDateTime(customer.restrictedAt)}.
          Do not contact this person or act on their data.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>{customer.email ?? "No email"}</p>
            <p>{customer.phone ?? "No phone"}</p>
            <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
              {customer.preferredLanguage ? <span>Language: {customer.preferredLanguage}</span> : null}
              {customer.preferredChannel ? <span>Channel: {customer.preferredChannel}</span> : null}
            </div>
            {customer.sourceSystem ? (
              <p className="pt-1 text-xs text-muted-foreground">
                Source: {customer.sourceSystem}
              </p>
            ) : null}
            {customer.matchReason ? (
              <p className="text-xs text-muted-foreground">
                Last identity match: {customer.matchReason.replace(/_/g, " ")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {customer.opportunities.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">None yet.</p>
            ) : (
              customer.opportunities.map((opp) => (
                <div key={opp.id} className="py-2.5 text-sm">
                  <Link
                    href={`/opportunities/${opp.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {opp.summary ?? opp.type}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{formatStage(opp.stage)}</Badge>
                    {opp.properties[0]?.propertyContext.referenceCode ? (
                      <span>{opp.properties[0].propertyContext.referenceCode}</span>
                    ) : null}
                    <span>{opp.assignee?.user.name ?? "Unassigned"}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {customer.activities.map((activity) => (
                <li key={activity.id} className="flex items-start gap-2 text-sm">
                  <ActorBadge actorType={activity.actorType} />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words">{activity.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(activity.occurredAt)}
                    </p>
                  </div>
                </li>
              ))}
              {customer.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity.</p>
              ) : null}
            </ol>
          </CardContent>
        </Card>
      </div>

      {canManagePrivacy ? (
        <Card className="mt-4 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <p className="text-muted-foreground">
                {customer.restrictedAt
                  ? "Processing is restricted for this person."
                  : "Restrict processing while a dispute or request is open. Data is kept, but must not be used."}
              </p>
              <form action={setRestrictionAction}>
                <input type="hidden" name="customerId" value={customer.id} />
                <input
                  type="hidden"
                  name="restricted"
                  value={customer.restrictedAt ? "false" : "true"}
                />
                <Button type="submit" variant="outline" size="sm">
                  {customer.restrictedAt ? "Resume processing" : "Restrict processing"}
                </Button>
              </form>
            </div>

            {customer.erasedAt ? null : (
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-muted-foreground">
                  Erase this person&apos;s personal data across customer record,
                  inquiry text, timeline, tasks and stored event payloads. This
                  cannot be undone, and it does not erase anything held in
                  Pronatona — see the runbook.
                </p>
                <ErasureForm customerId={customer.id} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
