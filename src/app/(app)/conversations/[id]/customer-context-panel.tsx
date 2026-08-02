import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { getCustomerContext } from "@/lib/services/customer-context";
import { formatDateTime, formatStage } from "@/lib/format";

const CHANNEL_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  SIMULATOR: "Simulator",
};

/**
 * What the organisation already knows about the linked customer — prior
 * conversations, open opportunities and tasks, recent timeline, and known
 * channel identities. Every section is scoped to what the caller could open
 * directly; empty sections are omitted rather than rendered hollow.
 */
export async function CustomerContextPanel({
  customerId,
  excludeConversationId,
}: {
  customerId: string;
  excludeConversationId: string;
}) {
  const ctx = await requireOrg();
  const context = await getCustomerContext(ctx, customerId, {
    excludeConversationId,
  });
  if (!context) return null;
  const { customer, priorConversations, opportunities, openTasks, activities } =
    context;

  const empty =
    priorConversations.length === 0 &&
    opportunities.length === 0 &&
    openTasks.length === 0 &&
    activities.length === 0 &&
    customer.channelIdentities.length === 0;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Customer context</h2>
      {empty ? (
        <p className="text-sm text-muted-foreground">
          Nothing else on record for this customer yet.
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          {customer.channelIdentities.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Known channel identities
              </h3>
              <ul className="space-y-0.5">
                {customer.channelIdentities.map((identity) => {
                  const consent = customer.consents.find(
                    (c) => c.channelType === identity.channelType,
                  );
                  return (
                    <li key={identity.id} className="text-muted-foreground">
                      {CHANNEL_LABELS[identity.channelType] ?? identity.channelType}
                      {" · "}
                      <span className="font-mono text-xs">{identity.externalId}</span>
                      {consent && consent.status !== "UNKNOWN" ? (
                        <span
                          className={
                            consent.status === "OPTED_OUT"
                              ? "ml-1 rounded-full border border-danger/60 px-1.5 text-[10px] text-danger"
                              : "ml-1 rounded-full border border-border px-1.5 text-[10px]"
                          }
                        >
                          {consent.status === "OPTED_OUT" ? "Opted out" : "Opted in"}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {priorConversations.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Prior conversations
              </h3>
              <ul className="space-y-1">
                {priorConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/conversations/${conversation.id}`}
                      className="text-primary hover:underline"
                    >
                      {conversation.subject ?? "Conversation"}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      {conversation.status} ·{" "}
                      {formatDateTime(conversation.lastMessageAt ?? conversation.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {opportunities.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Opportunities
              </h3>
              <ul className="space-y-1">
                {opportunities.map((opportunity) => (
                  <li key={opportunity.id}>
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="text-primary hover:underline"
                    >
                      {opportunity.summary ?? opportunity.type}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatStage(opportunity.stage)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {openTasks.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Open tasks
              </h3>
              <ul className="space-y-1">
                {openTasks.map((task) => (
                  <li key={task.id}>
                    {task.title}{" "}
                    <span className="text-xs text-muted-foreground">
                      {task.priority} · due {formatDateTime(task.dueAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {activities.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent timeline
              </h3>
              <ul className="space-y-1">
                {activities.map((activity) => (
                  <li key={activity.id} className="text-muted-foreground">
                    {activity.summary}{" "}
                    <span className="text-xs">
                      · {formatDateTime(activity.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
