import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import {
  getIntegrationHealth,
  listStaffMappings,
} from "@/lib/services/integrations";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { RotateSecretForm } from "./rotate-secret-form";
import {
  retryEventAction,
  setStatusAction,
  upsertStaffMappingAction,
} from "./actions";

export const metadata: Metadata = { title: "Pronatona integration" };

const STATUS_BADGE: Record<string, "default" | "outline" | "danger" | "outline"> = {
  PROCESSED: "default",
  RECEIVED: "outline",
  PROCESSING: "outline",
  FAILED: "danger",
  DEAD_LETTER: "danger",
};

export default async function PronatonaIntegrationPage() {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "integrations:manage")) redirect("/dashboard");

  const [health, mappings, members] = await Promise.all([
    getIntegrationHealth(ctx),
    listStaffMappings(ctx),
    listAssignableMembers(ctx),
  ]);

  if (!health) {
    return (
      <>
        <PageHeader title="Pronatona integration" />
        <p className="text-sm text-muted-foreground">
          Not provisioned yet — run the deployment seed.
        </p>
      </>
    );
  }

  const { integration, counts, eventTypes, recent } = health;

  return (
    <>
      <PageHeader
        title="Pronatona integration"
        description={`Source system ${integration.sourceSystem} · source organisation ${integration.sourceOrganisationId} → ${ctx.organisation.name}`}
      >
        <Badge variant={integration.status === "ACTIVE" ? "default" : "danger"}>
          {integration.status}
        </Badge>
        <form action={setStatusAction}>
          <input type="hidden" name="integrationId" value={integration.id} />
          <input
            type="hidden"
            name="status"
            value={integration.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
          />
          <Button type="submit" variant="outline" size="sm">
            {integration.status === "ACTIVE" ? "Disable" : "Enable"}
          </Button>
        </form>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["Processed", counts.processed, ""],
            ["Pending", counts.received + counts.processing, ""],
            ["Failed", counts.failed, counts.failed > 0 ? "text-danger" : ""],
            ["Dead-letter", counts.deadLetter, counts.deadLetter > 0 ? "text-danger" : ""],
          ] as const
        ).map(([label, value, tone]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="pt-5 text-sm">
            <p className="text-muted-foreground">
              Last received: {formatDateTime(integration.lastReceivedAt)}
            </p>
            <p className="text-muted-foreground">
              Last success: {formatDateTime(integration.lastSuccessfulAt)}
            </p>
            <p className={integration.lastErrorAt ? "text-danger" : "text-muted-foreground"}>
              Last error: {formatDateTime(integration.lastErrorAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent events</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Received</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((event) => (
                  <tr key={event.id}>
                    <td className="max-w-40 truncate py-2 pr-3 font-mono text-xs">
                      {event.eventId}
                    </td>
                    <td className="py-2 pr-3">{event.eventType}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={STATUS_BADGE[event.processingStatus] ?? "outline"}>
                        {event.processingStatus}
                      </Badge>
                      {event.lastError ? (
                        <p className="mt-0.5 max-w-56 truncate text-xs text-danger">
                          {event.lastError}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {formatDateTime(event.receivedAt)}
                    </td>
                    <td className="py-2">
                      {event.processingStatus === "FAILED" ||
                      event.processingStatus === "DEAD_LETTER" ? (
                        <form action={retryEventAction}>
                          <input type="hidden" name="eventId" value={event.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Retry
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      No events received yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event types received</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {eventTypes.length === 0 ? (
                <p className="text-muted-foreground">None yet.</p>
              ) : (
                eventTypes.map((row) => (
                  <div key={row.eventType} className="flex justify-between">
                    <span>{row.eventType}</span>
                    <span className="font-medium">{row.count}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Secret rotation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                The shared secret is stored encrypted and never displayed.
                Rotation takes effect immediately — coordinate with the
                Pronatona deployment.
              </p>
              <RotateSecretForm integrationId={integration.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Staff mappings</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Map Pronatona staff user ids to Operanto memberships so
                assignments carry over.
              </p>
              <ul className="mb-3 space-y-1 text-sm">
                {mappings.map((mapping) => {
                  const member = members.find((m) => m.id === mapping.operantoEntityId);
                  return (
                    <li key={mapping.id} className="flex justify-between gap-2">
                      <span className="truncate font-mono text-xs">
                        {mapping.sourceEntityId}
                      </span>
                      <span className="shrink-0">
                        → {member?.user.name ?? mapping.operantoEntityId}
                      </span>
                    </li>
                  );
                })}
                {mappings.length === 0 ? (
                  <li className="text-muted-foreground">No mappings yet.</li>
                ) : null}
              </ul>
              <form action={upsertStaffMappingAction} className="space-y-2">
                <Input
                  name="sourceStaffId"
                  placeholder="Pronatona staff user id"
                  required
                />
                <select
                  name="membershipId"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  required
                  aria-label="Operanto member"
                >
                  <option value="">Select member…</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.name} ({member.role})
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Save mapping
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
