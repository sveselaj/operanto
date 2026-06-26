import { notFound } from "next/navigation";
import Link from "next/link";
import { Target, MessageSquare, ListChecks, FileText, GitBranch, CalendarClock, FileBox, Share2 } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getOpportunity } from "@/lib/services/opportunities";
import { getWorkflowForOpportunity } from "@/lib/services/workflow";
import { listAppointments } from "@/lib/services/appointments";
import { listDocuments } from "@/lib/services/documents";
import { listAssignableMembers } from "@/lib/services/conversations";
import { requirementProgress } from "@/lib/opportunity-progress";
import {
  channelLabel,
  opportunityStatusLabel,
  opportunityStatusVariant,
  quoteStatusLabel,
  quoteStatusVariant,
} from "@/lib/labels";
import { relativeTime, formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpportunityControls } from "@/components/opportunities/opportunity-controls";
import { OpportunityAiButtons } from "@/components/opportunities/opportunity-ai-buttons";
import { RequirementChecklist } from "@/components/opportunities/requirement-checklist";
import { QuoteLauncher } from "@/components/opportunities/quote-launcher";
import { WorkflowCard } from "@/components/opportunities/workflow-card";
import { AppointmentsManager } from "@/components/opportunities/appointments-manager";
import { DocumentsManager } from "@/components/opportunities/documents-manager";
import { PushToCrmButton } from "@/components/opportunities/push-to-crm-button";

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace: slug, id } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "opportunities:manage")) notFound();

  const opp = await getOpportunity(ctx, id);
  if (!opp) notFound();

  const members = await listAssignableMembers(ctx);
  const workflow = await getWorkflowForOpportunity(ctx, opp.id);
  const progress = requirementProgress(opp.requirements);
  const canEdit = can(ctx.member.role, "opportunities:manage");
  const canQuote = can(ctx.member.role, "quotes:manage");
  const canWorkflow = can(ctx.member.role, "workflow:manage");
  const canSchedule = can(ctx.member.role, "appointments:manage");
  const canIntegrations = can(ctx.member.role, "integrations:manage");

  const memberOpts = members.map((m) => ({ id: m.userId, name: m.user.name }));
  const memberName = (id: string | null) => members.find((m) => m.userId === id)?.user.name ?? null;

  const [appointments, documents, lastCrm] = await Promise.all([
    canSchedule ? listAppointments(ctx, opp.id) : Promise.resolve([]),
    listDocuments(ctx, opp.id),
    canIntegrations
      ? prisma.integrationAction.findFirst({
          where: { workspaceId: ctx.workspace.id, entityType: "Opportunity", entityId: opp.id },
          orderBy: { createdAt: "desc" },
          select: { provider: true, status: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Opportunity" description={opp.customer?.name ?? undefined} />
      <div className="flex flex-col gap-5 px-6 py-5 lg:flex-row">
        {/* Main */}
        <div className="min-w-0 flex-1 space-y-5">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <Avatar name={opp.customer?.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold">
                      {opp.title ?? opp.customer?.name ?? "Opportunity"}
                    </h2>
                    <Badge variant={opportunityStatusVariant[opp.status]}>
                      {opportunityStatusLabel[opp.status]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {relativeTime(opp.createdAt)}
                    {opp.source ? ` · from ${opp.source}` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <OpportunityControls
                  slug={slug}
                  id={opp.id}
                  status={opp.status}
                  value={opp.value?.toString() ?? null}
                  currency={opp.currency}
                  assigneeId={opp.assignedToUserId}
                  members={members.map((m) => ({ id: m.userId, name: m.user.name }))}
                  canEdit={canEdit}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-1.5">
                <ListChecks className="size-4 text-primary" /> Requirements
                {progress.requiredTotal > 0 && (
                  <span
                    className={
                      progress.complete
                        ? "text-xs font-normal text-success"
                        : "text-xs font-normal text-muted-foreground"
                    }
                  >
                    {progress.requiredProvided}/{progress.requiredTotal} required
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && <OpportunityAiButtons slug={slug} opportunityId={opp.id} />}
              <RequirementChecklist
                slug={slug}
                opportunityId={opp.id}
                requirements={opp.requirements}
                canEdit={canEdit}
              />
            </CardContent>
          </Card>

          {canQuote && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-1.5">
                  <FileText className="size-4 text-primary" /> Quotes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <QuoteLauncher slug={slug} opportunityId={opp.id} />
                {opp.quotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No quotes yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {opp.quotes.map((q) => (
                      <Link
                        key={q.id}
                        href={`/${slug}/opportunities/${opp.id}/quotes/${q.id}`}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-medium">Quote #{q.id.slice(-6)}</span>
                          <Badge variant={quoteStatusVariant[q.status]}>{quoteStatusLabel[q.status]}</Badge>
                        </span>
                        <span className="tabular-nums font-medium">{formatMoney(q.total, q.currency)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {canSchedule && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <CalendarClock className="size-4 text-primary" /> Appointments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AppointmentsManager
                  slug={slug}
                  opportunityId={opp.id}
                  canManage={canSchedule}
                  members={memberOpts}
                  appointments={appointments.map((a) => ({
                    id: a.id,
                    type: a.type,
                    status: a.status,
                    title: a.title,
                    scheduledAt: a.scheduledAt ? a.scheduledAt.toISOString() : null,
                    durationMinutes: a.durationMinutes,
                    location: a.location,
                    assignee: memberName(a.assignedToUserId),
                  }))}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <FileBox className="size-4 text-primary" /> Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentsManager
                slug={slug}
                opportunityId={opp.id}
                canManage={canEdit}
                documents={documents.map((d) => ({
                  id: d.id,
                  fileName: d.fileName,
                  kind: d.kind,
                  status: d.status,
                  sizeBytes: d.sizeBytes,
                  createdAt: d.createdAt.toISOString(),
                  extraction: d.extraction
                    ? { data: (d.extraction.data as Record<string, string>) ?? {} }
                    : null,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* Side */}
        <aside className="w-full shrink-0 space-y-5 lg:w-80">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <GitBranch className="size-4 text-primary" /> Workflow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowCard
                slug={slug}
                opportunityId={opp.id}
                workflow={workflow}
                canManage={canWorkflow}
              />
            </CardContent>
          </Card>

          {canIntegrations && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Share2 className="size-4 text-primary" /> Integrations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PushToCrmButton slug={slug} opportunityId={opp.id} last={lastCrm} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                <Row label="Name" value={opp.customer?.name} />
                <Row label="Email" value={opp.customer?.email} />
                <Row label="Phone" value={opp.customer?.phone} />
                <Row label="Location" value={opp.customer?.location} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <MessageSquare className="size-4" /> Conversations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {opp.conversations.length === 0 && (
                <p className="text-xs text-muted-foreground">No linked conversations.</p>
              )}
              {opp.conversations.map((c) => (
                <Link
                  key={c.id}
                  href={`/${slug}/inbox/${c.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <span className="flex items-center gap-1.5">
                    <Target className="size-3.5 text-muted-foreground" />
                    {c.subject ?? channelLabel[c.channelType]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {c.lastMessageAt ? relativeTime(c.lastMessageAt) : ""}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value || "—"}</dd>
    </div>
  );
}
