import Link from "next/link";
import { Stethoscope, MessageSquareText, Package, Share2 } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { channelLabel } from "@/lib/labels";
import { channelConfigStates } from "@/lib/mediasync/channel-credentials";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChannelWidgetLink } from "@/components/settings/channel-widget-link";
import { ChannelCredentialsManager } from "@/components/settings/channel-credentials-manager";

const STATUS_VARIANT = {
  connected: "success",
  disconnected: "default",
  error: "danger",
  pending: "warning",
} as const;

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const w = ctx.workspace;
  const canManageMessaging = can(ctx.member.role, "messaging:manage");
  const canManageChannels = can(ctx.member.role, "channels:manage");
  const canManageIntegrations = can(ctx.member.role, "integrations:manage");

  const channels = await prisma.channelAccount.findMany({
    where: { workspaceId: w.id },
    orderBy: { createdAt: "asc" },
  });
  const configStates = canManageChannels ? await channelConfigStates(ctx) : [];

  const rows: [string, string][] = [
    ["Name", w.name],
    ["Slug", w.slug],
    ["Plan", w.plan],
    ["Timezone", w.timezone],
    ["Default language", w.defaultLanguage],
    ["AI auto-reply", w.aiAutoReplyEnabled ? "Enabled" : "Disabled (human approves)"],
    ["Data retention", w.dataRetentionDays ? `${w.dataRetentionDays} days` : "Indefinite"],
  ];

  return (
    <>
      <PageHeader title="Settings" description="Workspace configuration." />
      <div className="space-y-5 px-6 py-5">
        {canManageMessaging && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href={`/${slug}/settings/diagnostics`}
              className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
            >
              <Stethoscope className="size-5 text-primary" />
              <div>
                <div className="text-sm font-medium">Messaging diagnostics</div>
                <div className="text-xs text-muted-foreground">
                  Test-send and confirm webhook delivery per channel.
                </div>
              </div>
            </Link>
            <Link
              href={`/${slug}/settings/templates`}
              className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
            >
              <MessageSquareText className="size-5 text-primary" />
              <div>
                <div className="text-sm font-medium">Message templates</div>
                <div className="text-xs text-muted-foreground">
                  Reusable outbound templates for first contact.
                </div>
              </div>
            </Link>
            {canManageChannels && (
              <Link
                href={`/${slug}/settings/catalogue`}
                className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
              >
                <Package className="size-5 text-primary" />
                <div>
                  <div className="text-sm font-medium">Catalogue</div>
                  <div className="text-xs text-muted-foreground">
                    Products, services and pricing rules.
                  </div>
                </div>
              </Link>
            )}
            {canManageIntegrations && (
              <Link
                href={`/${slug}/settings/integrations`}
                className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
              >
                <Share2 className="size-5 text-primary" />
                <div>
                  <div className="text-sm font-medium">Integrations</div>
                  <div className="text-xs text-muted-foreground">
                    CRM/ERP pushes — status &amp; retries.
                  </div>
                </div>
              </Link>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {channels.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{channelLabel[c.type]}</div>
                  </div>
                  <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                </div>
                <div className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                  POST /api/webhooks/{c.type} · channelAccountId: {c.id}
                </div>
                {c.type === "webchat" && <ChannelWidgetLink channelAccountId={c.id} />}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Web chat works today via the public widget. WhatsApp, Messenger, Instagram, Telegram,
              Viber, and SMS connectors are live behind a common interface and activate once
              credentials and webhook verification are configured below.
            </p>
          </CardContent>
        </Card>

        {canManageChannels && (
          <Card>
            <CardHeader>
              <CardTitle>Channel credentials</CardTitle>
            </CardHeader>
            <CardContent>
              <ChannelCredentialsManager slug={slug} channels={configStates} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
