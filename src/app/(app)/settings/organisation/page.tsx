import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { renameOrganisationAction } from "./actions";
import { AiConfigForm } from "./ai-config-form";
import { getAiConfiguration } from "@/lib/services/ai-config";

export const metadata: Metadata = { title: "Organisation settings" };

export default async function OrganisationSettingsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "org:manage")) redirect("/dashboard");
  const aiConfig = await getAiConfiguration(ctx);

  return (
    <>
      <PageHeader title="Organisation" description="Identity and configuration.">
        <nav className="flex gap-2 text-sm">
          <Link href="/settings/users" className="text-primary hover:underline">
            Users
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/settings/security" className="text-primary hover:underline">
            Security
          </Link>
        </nav>
      </PageHeader>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={renameOrganisationAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={ctx.organisation.name}
                required
                maxLength={120}
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </form>
          <dl className="grid grid-cols-2 gap-2 border-t border-border pt-4 text-sm">
            <dt className="text-muted-foreground">Slug</dt>
            <dd>{ctx.organisation.slug}</dd>
            <dt className="text-muted-foreground">Vertical</dt>
            <dd>{ctx.organisation.vertical}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{ctx.organisation.status}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(ctx.organisation.createdAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">AI assistance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            AI output is always advisory: a person reviews and approves every
            draft, and nothing is ever sent externally. Live mode additionally
            requires the deployment-level opt-in and a provider key.
          </p>
          <AiConfigForm
            config={{
              enabled: aiConfig.enabled,
              mode: aiConfig.mode,
              model: aiConfig.model,
              monthlyRequestLimit: aiConfig.monthlyRequestLimit,
              periodRequestCount: aiConfig.periodRequestCount,
              permittedTaskTypes: aiConfig.permittedTaskTypes,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
