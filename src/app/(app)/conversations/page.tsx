import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import {
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  listConversations,
} from "@/lib/services/conversations";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversations" };

const STATUS_FILTERS = [
  { key: "", label: "All" },
  ...CONVERSATION_STATUSES.map((status) => ({
    key: status,
    label: status.charAt(0) + status.slice(1).toLowerCase(),
  })),
];

const CHANNEL_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  SIMULATOR: "Simulator",
};

function counterpartName(conversation: {
  customer: { name: string | null; erasedAt: Date | null } | null;
  participants: { displayName: string | null }[];
}): string {
  if (conversation.customer) {
    return conversation.customer.erasedAt
      ? "Erased customer"
      : (conversation.customer.name ?? "Customer");
  }
  return conversation.participants[0]?.displayName ?? "Unlinked counterpart";
}

export default async function ConversationsPage({
  searchParams,
}: PageProps<"/conversations">) {
  const ctx = await requireOrg();
  const params = await searchParams;

  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const statusParam = str(params.status);
  const priorityParam = str(params.priority);
  const status = CONVERSATION_STATUSES.find((s) => s === statusParam);
  const priority = CONVERSATION_PRIORITIES.find((p) => p === priorityParam);
  const assigned = str(params.assigned);
  const q = str(params.q);
  const cursor = str(params.cursor);

  const [{ conversations, nextCursor }, members] = await Promise.all([
    listConversations(ctx, { status, priority, assigned, q, cursor }),
    listAssignableMembers(ctx),
  ]);

  const query = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      status: statusParam,
      priority: priorityParam,
      assigned,
      q,
      ...overrides,
    };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) usp.set(key, value);
    }
    const s = usp.toString();
    return s ? `/conversations?${s}` : "/conversations";
  };

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Customer conversations across all connected channels."
      >
        <Link
          href="/conversations/new"
          className="h-9 rounded-md bg-primary px-3 text-sm leading-9 text-primary-foreground hover:opacity-90"
        >
          New conversation
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key || "all"}
              href={query({ status: f.key || undefined, cursor: undefined })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                (statusParam ?? "") === f.key
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:border-ring/50",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/conversations">
          {statusParam ? <input type="hidden" name="status" value={statusParam} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search subject or name…"
            aria-label="Search conversations"
            className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm"
          />
          <select
            name="priority"
            defaultValue={priorityParam ?? ""}
            aria-label="Filter by priority"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Any priority</option>
            {CONVERSATION_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <select
            name="assigned"
            defaultValue={assigned ?? ""}
            aria-label="Filter by assignee"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Any assignee</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.user.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            Filter
          </button>
        </form>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No conversations in this view. Start one with “New conversation”.
          </p>
        ) : (
          conversations.map((conversation) => {
            const lastMessage = conversation.messages[0];
            return (
              <Link
                key={conversation.id}
                href={`/conversations/${conversation.id}`}
                className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {counterpartName(conversation)}
                    {conversation.customer?.restrictedAt ? (
                      <span className="rounded-full border border-warning px-2 py-0.5 text-[11px] font-normal text-warning">
                        Restricted
                      </span>
                    ) : null}
                  </p>
                  {conversation.subject ? (
                    <p className="truncate text-muted-foreground">{conversation.subject}</p>
                  ) : null}
                  {lastMessage ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {lastMessage.direction === "INBOUND" ? "← " : "→ "}
                      {lastMessage.redactedAt ? "(content redacted)" : lastMessage.body}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 space-y-1 text-right text-xs text-muted-foreground">
                  <p>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5",
                        conversation.status === "OPEN"
                          ? "border-primary text-primary"
                          : "border-border",
                      )}
                    >
                      {conversation.status}
                    </span>{" "}
                    <span
                      className={cn(
                        conversation.priority === "URGENT" || conversation.priority === "HIGH"
                          ? "text-danger"
                          : undefined,
                      )}
                    >
                      {conversation.priority}
                    </span>
                  </p>
                  <p>
                    {conversation.assignee?.user.name ?? "Unassigned"} ·{" "}
                    {CHANNEL_LABELS[conversation.channelType] ?? conversation.channelType}
                  </p>
                  <p>{formatDateTime(conversation.lastMessageAt ?? conversation.createdAt)}</p>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {nextCursor ? (
        <div className="mt-4 text-center">
          <Link
            href={query({ cursor: nextCursor })}
            className="inline-block rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </>
  );
}
