import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import {
  listConversations,
  conversationStatusCounts,
  type ConversationFilters,
} from "@/lib/services/conversations";
import { relativeTime } from "@/lib/utils";
import { channelLabel, priorityVariant, priorityLabel } from "@/lib/labels";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InboxFilters } from "@/components/inbox/inbox-filters";

export async function ConversationListPanel({
  slug,
  filters,
  activeId,
}: {
  slug: string;
  filters: ConversationFilters;
  activeId?: string;
}) {
  const ctx = await requireWorkspace(slug);
  const [conversations, counts] = await Promise.all([
    listConversations(ctx, filters),
    conversationStatusCounts(ctx),
  ]);

  // Preserve active filters when navigating between conversations.
  const qs = new URLSearchParams();
  if (filters.status && filters.status !== "all") qs.set("status", filters.status);
  if (filters.channel && filters.channel !== "all") qs.set("channel", filters.channel);
  if (filters.assignee && filters.assignee !== "all") qs.set("assignee", filters.assignee);
  if (filters.q) qs.set("q", filters.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-r border-border bg-card">
      <InboxFilters counts={counts} />
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No conversations match these filters.
          </p>
        )}
        {conversations.map((c) => {
          const active = c.id === activeId;
          const unread = c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt);
          return (
            <Link
              key={c.id}
              href={`/${slug}/inbox/${c.id}${suffix}`}
              className={
                "block border-b border-border px-3 py-3 transition-colors " +
                (active ? "bg-accent" : "hover:bg-muted")
              }
            >
              <div className="flex items-start gap-3">
                <Avatar name={c.customer?.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {unread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      {c.customer?.name ?? "Unknown"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.summary ?? c.subject ?? "—"}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <Badge variant="default">{channelLabel[c.channelType]}</Badge>
                    {c.priority !== "normal" && c.priority !== "low" && (
                      <Badge variant={priorityVariant[c.priority]}>
                        {priorityLabel[c.priority]}
                      </Badge>
                    )}
                    {typeof c.leadScore === "number" && c.leadScore >= 70 && (
                      <Badge variant="warning">Lead {c.leadScore}</Badge>
                    )}
                    {c.tags.map((ct) => (
                      <span
                        key={ct.tag.id}
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]"
                        style={{ color: ct.tag.color }}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: ct.tag.color }}
                        />
                        {ct.tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
