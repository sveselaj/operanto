import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { listAuditEvents } from "@/lib/services/activity";
import { PageHeader } from "@/components/app/page-header";
import { ActorBadge } from "@/components/app/actor-badge";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "audit:view")) redirect("/dashboard");
  const params = await searchParams;
  const targetType = typeof params.target === "string" ? params.target : undefined;
  const events = await listAuditEvents(ctx, { targetType });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Immutable record of staff, system, and integration actions."
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Actor</th>
              <th className="px-4 py-2.5 font-medium">Event</th>
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-4 py-2.5 font-medium">Correlation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No audit events.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActorBadge actorType={event.actorType} />
                  </td>
                  <td className="px-4 py-2.5 font-medium">{event.eventType}</td>
                  <td className="px-4 py-2.5">
                    {event.targetType}
                    {event.targetId ? (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">
                        {event.targetId.slice(0, 12)}…
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-40 truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {event.correlationId ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
