import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { relativeTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { ApprovalCard } from "@/components/cockpit/approval-card";
import { listApprovals, expireStaleApprovals } from "@/lib/services/approvals";

const STATUS_VARIANT: Record<string, "success" | "danger" | "default" | "warning"> = {
  approved: "success",
  rejected: "default",
  expired: "warning",
  pending: "warning",
};

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "approvals:review")) redirect(`/${slug}/command`);

  await expireStaleApprovals(ctx);
  const all = await listApprovals(ctx, "all");
  const pending = all.filter((a) => a.status === "pending");
  const resolved = all.filter((a) => a.status !== "pending").slice(0, 40);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Approvals"
        description="Sensitive actions the assistant prepared. Nothing here has run — approve to execute."
      />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Awaiting review ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing awaiting approval. When the assistant proposes a sensitive action, it appears here.
            </p>
          ) : (
            <div className="space-y-3">
              {pending.map((a) => (
                <ApprovalCard
                  key={a.id}
                  slug={slug}
                  block={{
                    approvalId: a.id,
                    invocationId: a.toolInvocationId,
                    toolName: a.toolInvocation.toolName,
                    title: a.toolInvocation.title,
                    summary: a.summary ?? a.toolInvocation.title,
                    risk: a.toolInvocation.risk,
                    status: a.status,
                    data: (a.toolInvocation.input as Record<string, unknown>) ?? {},
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {resolved.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Recently resolved</h2>
            <div className="divide-y divide-border rounded-lg border border-border">
              {resolved.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.toolInvocation.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{a.summary}</div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <Badge variant={STATUS_VARIANT[a.status] ?? "default"} className="capitalize">
                      {a.status}
                    </Badge>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {a.reviewedBy?.name ? `${a.reviewedBy.name} · ` : ""}
                      {relativeTime(a.reviewedAt ?? a.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
