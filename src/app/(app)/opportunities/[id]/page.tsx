import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import {
  getOpportunity,
  listAssignableMembers,
  OPPORTUNITY_STAGES,
} from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { ActorBadge } from "@/components/app/actor-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatPrice, formatStage } from "@/lib/format";
import {
  addNoteAction,
  assignAction,
  createTaskAction,
  toggleTaskAction,
  updateStageAction,
} from "./actions";

export const metadata: Metadata = { title: "Opportunity" };

export default async function OpportunityDetailPage({
  params,
}: PageProps<"/opportunities/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const opportunity = await getOpportunity(ctx, id);
  if (!opportunity) notFound();

  const canAssign = can(ctx.membership.role, "opportunities:assign");
  const members = await listAssignableMembers(ctx);
  const property = opportunity.properties[0]?.propertyContext ?? null;

  return (
    <>
      <PageHeader
        title={opportunity.customer.name ?? "Unknown customer"}
        description={opportunity.summary ?? opportunity.type}
      >
        <Badge variant="outline">{formatStage(opportunity.stage)}</Badge>
        {opportunity.sourceStage ? (
          <span className="text-xs text-muted-foreground">
            Pronatona status: {opportunity.sourceStage}
          </span>
        ) : null}
      </PageHeader>

      {opportunity.customer.restrictedAt ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          Processing is restricted for this customer. Do not contact them or act
          on their data while the restriction is in place.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column: customer + property + inquiry */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="font-medium">
                <Link
                  href={`/customers/${opportunity.customer.id}`}
                  className="text-primary hover:underline"
                >
                  {opportunity.customer.name ?? "Unnamed"}
                </Link>
              </p>
              <p className="text-muted-foreground">
                {opportunity.customer.email ?? "No email"}
              </p>
              <p className="text-muted-foreground">
                {opportunity.customer.phone ?? "No phone"}
              </p>
              <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
                {opportunity.customer.preferredLanguage ? (
                  <span>Language: {opportunity.customer.preferredLanguage}</span>
                ) : null}
                {opportunity.customer.preferredChannel ? (
                  <span>Channel: {opportunity.customer.preferredChannel}</span>
                ) : null}
              </div>
              {opportunity.sourceChannel ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  Source: {opportunity.sourceChannel}
                  {opportunity.sourceSystem ? ` · ${opportunity.sourceSystem}` : null}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {property ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Property</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <p className="font-medium">{property.title ?? property.referenceCode}</p>
                <p className="text-muted-foreground">
                  {property.referenceCode}
                  {property.city ? ` · ${property.city}` : null}
                </p>
                <p>{formatPrice(property.price, property.currency)}</p>
                {property.status ? (
                  <Badge variant="outline">{property.status}</Badge>
                ) : null}
                {property.sourceUrl ? (
                  <p className="pt-1">
                    <a
                      href={property.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      View on Pronatona <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {opportunity.inquiryText ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inquiry</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{opportunity.inquiryText}</p>
                {opportunity.preferredDate ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Preferred viewing date: {formatDateTime(opportunity.preferredDate)}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <form action={updateStageAction} className="flex items-center gap-2">
                <input type="hidden" name="opportunityId" value={opportunity.id} />
                <select
                  name="stage"
                  defaultValue={opportunity.stage}
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="Stage"
                >
                  {OPPORTUNITY_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {formatStage(stage)}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Set stage
                </Button>
              </form>

              {canAssign ? (
                <form action={assignAction} className="flex items-center gap-2">
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <select
                    name="membershipId"
                    defaultValue={opportunity.assignedMembershipId ?? ""}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label="Assignee"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.user.name} ({member.role})
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" size="sm">
                    Assign
                  </Button>
                </form>
              ) : (
                <p className="text-muted-foreground">
                  Assigned to: {opportunity.assignee?.user.name ?? "Unassigned"}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Middle column: timeline */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addNoteAction} className="mb-4 space-y-2">
              <input type="hidden" name="opportunityId" value={opportunity.id} />
              <Textarea
                name="body"
                placeholder="Add an internal note…"
                rows={2}
                maxLength={5000}
                required
              />
              <Button type="submit" variant="outline" size="sm">
                Add note
              </Button>
            </form>
            <ol className="space-y-3">
              {opportunity.activities.map((activity) => (
                <li key={activity.id} className="flex items-start gap-2 text-sm">
                  <ActorBadge actorType={activity.actorType} />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words">{activity.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.activityType} · {formatDateTime(activity.occurredAt)}
                    </p>
                  </div>
                </li>
              ))}
              {opportunity.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : null}
            </ol>
          </CardContent>
        </Card>

        {/* Right column: tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createTaskAction} className="mb-4 space-y-2">
              <input type="hidden" name="opportunityId" value={opportunity.id} />
              <Input name="title" placeholder="New task…" required maxLength={200} />
              <div className="flex gap-2">
                <Input name="dueAt" type="datetime-local" className="flex-1" aria-label="Due" />
                <select
                  name="assignedMembershipId"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  defaultValue={opportunity.assignedMembershipId ?? ""}
                  aria-label="Task assignee"
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="outline" size="sm">
                Create task
              </Button>
            </form>
            <ul className="space-y-2.5">
              {opportunity.tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-2 text-sm">
                  <form action={toggleTaskAction}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="opportunityId" value={opportunity.id} />
                    <input
                      type="hidden"
                      name="nextStatus"
                      value={task.status === "OPEN" ? "COMPLETED" : "OPEN"}
                    />
                    <button
                      type="submit"
                      className="mt-0.5 h-4 w-4 rounded border border-input bg-background text-primary"
                      aria-label={task.status === "OPEN" ? "Complete task" : "Reopen task"}
                    >
                      {task.status === "COMPLETED" ? "✓" : ""}
                    </button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        task.status === "COMPLETED"
                          ? "text-muted-foreground line-through"
                          : undefined
                      }
                    >
                      {task.title}
                    </p>
                    <p
                      className={
                        task.status === "OPEN" && task.dueAt && task.dueAt < new Date()
                          ? "text-xs text-danger"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      Due {formatDateTime(task.dueAt)} · {task.priority}
                    </p>
                  </div>
                </li>
              ))}
              {opportunity.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
