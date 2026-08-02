import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { getPronatonaIntegration } from "@/lib/services/integrations";
import { prisma } from "@/lib/prisma";
import { scope } from "@/lib/org-context";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "integrations:manage")) redirect("/dashboard");
  const integration = await getPronatonaIntegration(ctx);
  const channelConnections = can(ctx.membership.role, "channels:manage")
    ? await prisma.channelConnection.findMany({
        where: scope(ctx),
        orderBy: [{ type: "asc" }, { displayName: "asc" }],
      })
    : [];

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Source systems sending signed events into this organisation."
      />
      {integration ? (
        <Link href="/integrations/pronatona">
          <Card className="max-w-xl transition-colors hover:border-ring/40">
            <CardContent className="flex items-center justify-between pt-5">
              <div>
                <p className="font-medium">Pronatona</p>
                <p className="text-sm text-muted-foreground">
                  {integration.sourceSystem} · last event{" "}
                  {formatDateTime(integration.lastReceivedAt)}
                </p>
              </div>
              <Badge
                variant={integration.status === "ACTIVE" ? "default" : "danger"}
              >
                {integration.status}
              </Badge>
            </CardContent>
          </Card>
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">
          No integrations registered. The Pronatona integration is provisioned by
          the deployment seed.
        </p>
      )}

      {channelConnections.length > 0 ? (
        <div className="mt-6 max-w-xl">
          <h2 className="mb-2 text-sm font-semibold">Conversation channels</h2>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {channelConnections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{connection.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {connection.type} · last received{" "}
                    {formatDateTime(connection.lastReceivedAt)}
                    {connection.lastErrorAt
                      ? ` · last error ${formatDateTime(connection.lastErrorAt)}`
                      : ""}
                  </p>
                </div>
                <Badge variant={connection.status === "ACTIVE" ? "default" : "danger"}>
                  {connection.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
