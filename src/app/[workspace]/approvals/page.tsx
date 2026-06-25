import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { listApprovals } from "@/lib/services/approvals";
import { PageHeader } from "@/components/layout/page-header";
import { ApprovalRow, type ApprovalView } from "@/components/approvals/approval-row";

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const canDecide = can(ctx.member.role, "approvals:decide");
  if (!canDecide && !can(ctx.member.role, "quotes:manage")) notFound();

  const approvals = await listApprovals(ctx);

  // Resolve requester/decider names and quote → opportunity hrefs.
  const userIds = [
    ...new Set(approvals.flatMap((a) => [a.requestedByUserId, a.decidedByUserId].filter(Boolean) as string[])),
  ];
  const quoteIds = approvals.filter((a) => a.entityType === "Quote").map((a) => a.entityId);
  const [users, quotes] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.quote.findMany({
      where: { id: { in: quoteIds }, workspaceId: ctx.workspace.id },
      select: { id: true, opportunityId: true },
    }),
  ]);
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);
  const quoteOpp = new Map(quotes.map((q) => [q.id, q.opportunityId]));

  const views: ApprovalView[] = approvals.map((a) => {
    const payload = (a.payload as { label?: string; amount?: number } | null) ?? null;
    const payloadSummary =
      a.action === "price.override" && payload
        ? `${payload.label ?? "Adjustment"}: ${payload.amount}`
        : null;
    const oppId = a.entityType === "Quote" ? quoteOpp.get(a.entityId) : null;
    return {
      id: a.id,
      entityType: a.entityType,
      entityId: a.entityId,
      action: a.action,
      status: a.status,
      reason: a.reason,
      decisionNote: a.decisionNote,
      requestedBy: nameOf(a.requestedByUserId),
      decidedBy: nameOf(a.decidedByUserId),
      createdAt: a.createdAt.toISOString(),
      payloadSummary,
      href: oppId ? `/${slug}/opportunities/${oppId}/quotes/${a.entityId}` : null,
    };
  });

  const pending = views.filter((v) => v.status === "pending");
  const decided = views.filter((v) => v.status !== "pending");

  return (
    <>
      <PageHeader
        title="Approvals"
        description={canDecide ? "Approve or reject gated actions." : "Your approval requests."}
      />
      <div className="space-y-5 px-6 py-5">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            pending.map((v) => (
              <ApprovalRow
                key={v.id}
                slug={slug}
                approval={v}
                canDecide={canDecide}
                canCancel={approvals.find((a) => a.id === v.id)?.requestedByUserId === ctx.userId}
              />
            ))
          )}
        </section>

        {decided.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Decided
            </h2>
            {decided.map((v) => (
              <ApprovalRow key={v.id} slug={slug} approval={v} canDecide={false} canCancel={false} />
            ))}
          </section>
        )}
      </div>
    </>
  );
}
