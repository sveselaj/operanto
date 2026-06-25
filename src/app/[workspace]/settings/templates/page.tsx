import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { listTemplates } from "@/lib/mediasync/templates";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TemplateManager } from "@/components/settings/template-manager";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const templates = await listTemplates(ctx);
  const canManage = can(ctx.member.role, "messaging:manage");

  return (
    <>
      <PageHeader
        title="Message templates"
        description="MediaSync — reusable outbound templates for first-contact and out-of-window sends."
      />
      <div className="space-y-5 px-6 py-5">
        <Link href={`/${slug}/settings`} className="text-xs text-primary hover:underline">
          ← Back to settings
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateManager slug={slug} templates={templates} canManage={canManage} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
