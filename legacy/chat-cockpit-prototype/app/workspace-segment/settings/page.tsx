import { requireWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { channelLabel } from "@/lib/labels";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChannelWidgetLink } from "@/components/settings/channel-widget-link";

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

  const channels = await prisma.channelAccount.findMany({
    where: { workspaceId: w.id },
    orderBy: { createdAt: "asc" },
  });

  const rows: [string, string][] = [
    ["Name", w.name],
    ["Slug", w.slug],
    ["Plan", w.plan],
    ["Timezone", w.timezone],
    ["Default language", w.defaultLanguage],
  ];

  return (
    <>
      <PageHeader title="Settings" description="Workspace configuration." />
      <div className="space-y-5 px-6 py-5">
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
              Web chat works today via the public widget. Instagram, Facebook, WhatsApp, email, and
              SMS connectors are implemented behind a common interface and activate once credentials
              and webhook verification are configured.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
