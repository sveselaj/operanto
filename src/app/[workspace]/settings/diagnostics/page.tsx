import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { channelDiagnostics } from "@/lib/mediasync/diagnostics";
import { listSyncJobs } from "@/lib/mediasync/sync";
import { relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DiagnosticsRunner } from "@/components/settings/diagnostics-runner";

const JOB_VARIANT = { running: "warning", success: "success", error: "danger" } as const;

export default async function DiagnosticsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "messaging:manage")) notFound();

  const [channels, diagnostics, jobs] = await Promise.all([
    prisma.channelAccount.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true },
    }),
    channelDiagnostics(ctx),
    listSyncJobs(ctx.workspace.id, 15),
  ]);

  return (
    <>
      <PageHeader
        title="Messaging diagnostics"
        description="MediaSync — test-send per channel and confirm inbound webhook delivery."
      />
      <div className="space-y-5 px-6 py-5">
        <Link href={`/${slug}/settings`} className="text-xs text-primary hover:underline">
          ← Back to settings
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Test-send</CardTitle>
          </CardHeader>
          <CardContent>
            <DiagnosticsRunner slug={slug} channels={channels} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receive check</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {diagnostics.map((d) => (
              <div
                key={d.channelAccountId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.type}</div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span>
                    Last inbound:{" "}
                    <span className="font-medium text-foreground">
                      {d.lastInboundAt ? relativeTime(d.lastInboundAt) : "never"}
                    </span>
                  </span>
                  <span>
                    Last webhook:{" "}
                    <span className="font-medium text-foreground">
                      {d.lastWebhookAt ? relativeTime(d.lastWebhookAt) : "never"}
                    </span>
                    {d.lastWebhookStatus ? ` (${d.lastWebhookStatus})` : ""}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent sync jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {jobs.length === 0 && (
              <p className="text-xs text-muted-foreground">No connector activity yet.</p>
            )}
            {jobs.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={JOB_VARIANT[j.status]}>{j.status}</Badge>
                  <span className="font-medium">{j.channelType}</span>
                  <span className="text-muted-foreground">{j.operation}</span>
                </div>
                <div className="text-muted-foreground">
                  {j.detail ?? j.error ?? ""}
                  {typeof j.durationMs === "number" ? ` · ${j.durationMs}ms` : ""} ·{" "}
                  {relativeTime(j.startedAt)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
