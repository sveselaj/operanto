import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { listIntegrationActions, integrationProviderStates } from "@/lib/services/integrations";
import { integrationStatusVariant } from "@/lib/labels";
import { relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IntegrationRetryButton } from "@/components/settings/integration-retry-button";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "integrations:manage")) notFound();

  const [providers, actions] = await Promise.all([
    integrationProviderStates(ctx),
    listIntegrationActions(ctx, 30),
  ]);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="CRM/ERP pushes — idempotent and retried, mirroring the messaging connectors."
      />
      <div className="space-y-5 px-6 py-5">
        <Link href={`/${slug}/settings`} className="text-xs text-primary hover:underline">
          ← Back to settings
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {providers.map((p) => (
              <div key={p.provider} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{p.provider}</span>
                {p.configured ? <Badge variant="success">Configured</Badge> : <Badge variant="warning">Default / simulated</Badge>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Set <span className="font-mono">HUBSPOT_TOKEN</span> for HubSpot, or{" "}
              <span className="font-mono">INTEGRATION_WEBHOOK_URL</span> for the generic webhook. With
              neither, pushes are simulated so the flow is demoable.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {actions.length === 0 && <p className="text-xs text-muted-foreground">No integration activity yet.</p>}
            {actions.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant={integrationStatusVariant[a.status]}>{a.status}</Badge>
                  <span className="font-medium">{a.provider}</span>
                  <span className="text-muted-foreground">{a.operation}</span>
                  {a.entityType && <span className="text-muted-foreground">· {a.entityType}</span>}
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  {a.error && <span className="text-danger">{a.error.slice(0, 60)}</span>}
                  <span>attempt {a.attempts}/{a.maxAttempts}</span>
                  <span>{relativeTime(a.createdAt)}</span>
                  {a.status === "failed" && a.attempts < a.maxAttempts && (
                    <IntegrationRetryButton slug={slug} id={a.id} />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
