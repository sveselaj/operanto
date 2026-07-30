import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { listActivity } from "@/lib/services/activity";
import { PageHeader } from "@/components/app/page-header";
import { ActorBadge } from "@/components/app/actor-badge";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const ctx = await requireOrg();
  const activities = await listActivity(ctx);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything that happened across customers and opportunities, in order."
      />
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {activities.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          activities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <ActorBadge actorType={activity.actorType} />
              <div className="min-w-0 flex-1">
                <p className="break-words">
                  {activity.opportunity ? (
                    <Link
                      href={`/opportunities/${activity.opportunity.id}`}
                      className="hover:text-primary"
                    >
                      {activity.summary}
                    </Link>
                  ) : (
                    activity.summary
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activity.activityType}
                  {activity.customer?.name ? ` · ${activity.customer.name}` : null}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(activity.occurredAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
