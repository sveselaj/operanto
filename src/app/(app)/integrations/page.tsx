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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { WhatsAppConnectForm } from "./whatsapp-connect-form";
import {
  createTemplateAction,
  setStageGateAction,
  setTemplateStatusAction,
  verifyConnectionAction,
} from "./whatsapp-actions";
import { Input } from "@/components/ui/input";

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
  const templates = can(ctx.membership.role, "templates:manage")
    ? await prisma.messageTemplate.findMany({
        where: scope(ctx),
        orderBy: [{ name: "asc" }, { language: "asc" }],
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
                data-testid={`connection-${connection.type}-${connection.phoneNumberId ?? connection.id}`}
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
                    {connection.type === "WHATSAPP"
                      ? ` · verified ${formatDateTime(connection.lastVerifiedAt)}`
                      : ""}
                  </p>
                  {connection.type === "WHATSAPP" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={connection.inboundEnabled ? "default" : "outline"}>
                        inbound {connection.inboundEnabled ? "on" : "off"}
                      </Badge>
                      <Badge variant={connection.outboundEnabled ? "default" : "outline"}>
                        outbound {connection.outboundEnabled ? "on" : "off"}
                      </Badge>
                      <form action={setStageGateAction}>
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <input type="hidden" name="gate" value="inbound" />
                        <input
                          type="hidden"
                          name="enabled"
                          value={connection.inboundEnabled ? "false" : "true"}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          {connection.inboundEnabled ? "Disable inbound" : "Enable inbound"}
                        </Button>
                      </form>
                      <form action={setStageGateAction}>
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <input type="hidden" name="gate" value="outbound" />
                        <input
                          type="hidden"
                          name="enabled"
                          value={connection.outboundEnabled ? "false" : "true"}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          {connection.outboundEnabled
                            ? "Disable outbound"
                            : "Enable outbound"}
                        </Button>
                      </form>
                      <form action={verifyConnectionAction}>
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Verify connection
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </div>
                <Badge variant={connection.status === "ACTIVE" ? "default" : "danger"}>
                  {connection.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {can(ctx.membership.role, "templates:manage") ? (
        <div className="mt-6 max-w-xl">
          <h2 className="mb-2 text-sm font-semibold">WhatsApp message templates</h2>
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="text-xs text-muted-foreground">
                Mirror templates approved in Meta Business Manager. Only APPROVED
                rows can be sent outside the 24-hour service window, and only by
                selection — never by client-provided name.
              </p>
              {templates.length > 0 ? (
                <div className="divide-y divide-border rounded-md border border-border">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {template.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({template.language})
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {template.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant={template.status === "APPROVED" ? "default" : "outline"}
                        >
                          {template.status}
                        </Badge>
                        {template.status !== "APPROVED" ? (
                          <form action={setTemplateStatusAction}>
                            <input type="hidden" name="templateId" value={template.id} />
                            <input type="hidden" name="status" value="APPROVED" />
                            <Button type="submit" variant="outline" size="sm">
                              Mark approved
                            </Button>
                          </form>
                        ) : (
                          <form action={setTemplateStatusAction}>
                            <input type="hidden" name="templateId" value={template.id} />
                            <input type="hidden" name="status" value="REJECTED" />
                            <Button type="submit" variant="outline" size="sm">
                              Revoke
                            </Button>
                          </form>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <form action={createTemplateAction} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input name="name" placeholder="Template name" required autoComplete="off" />
                  <Input name="language" placeholder="Language (e.g. sq, en_US)" required autoComplete="off" />
                </div>
                <Input name="body" placeholder="Template body (preview text)" required autoComplete="off" />
                <Button type="submit" variant="outline" size="sm">
                  Add template
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {can(ctx.membership.role, "channels:connect") ? (
        <div className="mt-6 max-w-xl">
          <h2 className="mb-2 text-sm font-semibold">Connect WhatsApp Cloud</h2>
          <Card>
            <CardContent className="pt-5">
              <p className="mb-3 text-xs text-muted-foreground">
                Connect this organisation&apos;s WhatsApp Business Account under the
                Operanto-managed Meta application. The access token is stored
                encrypted; inbound and outbound stay disabled until enabled
                per stage above.
              </p>
              <WhatsAppConnectForm />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
