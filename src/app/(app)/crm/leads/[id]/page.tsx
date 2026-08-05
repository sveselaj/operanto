import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { allowedTransitions, getLead } from "@/lib/services/crm/leads";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { requiresReason, requiresSchedule } from "@operanto/crm-leadstatus";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatStage } from "@/lib/format";
import { assignLeadAction, transitionLeadAction } from "./actions";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: PageProps<"/crm/leads/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const lead = await getLead(ctx, id);
  if (!lead) notFound();

  const canTransitionLead = can(ctx.membership.role, "crm.leads.transition");
  const canAssign = can(ctx.membership.role, "crm.leads.assign");
  const targets = allowedTransitions(lead.status);
  const needsExtras = targets.some((t) => requiresReason(t) || requiresSchedule(t));
  const members = canAssign ? await listAssignableMembers(ctx) : [];

  return (
    <>
      <PageHeader title={lead.fullName} description={lead.companyName ?? undefined}>
        <Link href="/crm/leads" className="text-sm text-muted-foreground hover:underline">
          ← All leads
        </Link>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Pipeline</span>
                <Badge variant="outline">{formatStage(lead.status)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lead.doNotCall ? (
                <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
                  Do not contact — outbound work on this lead is blocked.
                </p>
              ) : null}
              {canTransitionLead && targets.length > 0 ? (
                <form action={transitionLeadAction} className="space-y-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <div className="flex items-center gap-2">
                    <select
                      name="to"
                      className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                      aria-label="New status"
                      defaultValue=""
                      required
                    >
                      <option value="" disabled>
                        Change status…
                      </option>
                      {targets.map((t) => (
                        <option key={t} value={t}>
                          {formatStage(t)}
                          {requiresReason(t) ? " (reason required)" : ""}
                          {requiresSchedule(t) ? " (date required)" : ""}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="outline" size="sm">
                      Apply
                    </Button>
                  </div>
                  {needsExtras ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input name="reason" placeholder="Reason (for negative statuses)" maxLength={500} />
                      <Input
                        name="scheduledAt"
                        type="datetime-local"
                        aria-label="Scheduled date (for callback / retry)"
                      />
                    </div>
                  ) : null}
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {lead.activities.map((activity) => (
                    <li key={activity.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                          {activity.activityType}
                        </span>
                        {activity.summary}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(activity.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p>
                <span className="text-muted-foreground">Phone:</span>{" "}
                {lead.phoneNormalized ?? lead.phone ?? "—"}
                {lead.phoneStatus !== "VALID" ? (
                  <Badge variant="outline" className="ml-2">
                    {lead.phoneStatus}
                  </Badge>
                ) : null}
              </p>
              <p>
                <span className="text-muted-foreground">Email:</span> {lead.email ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Source:</span>{" "}
                {lead.source ?? lead.origin}
              </p>
              <p>
                <span className="text-muted-foreground">Customer:</span>{" "}
                {lead.customer ? (
                  <Link href={`/customers/${lead.customer.id}`} className="hover:underline">
                    {lead.customer.erasedAt ? "[erased]" : lead.customer.name}
                  </Link>
                ) : (
                  "Not linked"
                )}
              </p>
              <p>
                <span className="text-muted-foreground">Callback:</span>{" "}
                {formatDateTime(lead.callbackAt)}
              </p>
              <p>
                <span className="text-muted-foreground">Next action:</span>{" "}
                {formatDateTime(lead.nextActionAt)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-sm text-muted-foreground">
                {lead.assignee ? lead.assignee.user.name : "Unassigned"}
              </p>
              {canAssign ? (
                <form action={assignLeadAction} className="flex items-center gap-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <select
                    name="membershipId"
                    defaultValue={lead.assignedMembershipId ?? ""}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label="Assignee"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.user.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" size="sm">
                    Assign
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {lead.statusHistory.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-2">
                    <span>
                      {entry.previousStatus ? `${formatStage(entry.previousStatus)} → ` : ""}
                      {formatStage(entry.newStatus)}
                      {entry.reason ? (
                        <span className="ml-1 text-muted-foreground">({entry.reason})</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
