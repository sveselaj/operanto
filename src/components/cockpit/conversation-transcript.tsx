import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, relativeTime } from "@/lib/utils";

export type TranscriptMessage = {
  id: string;
  direction: string; // inbound | outbound | internal
  senderType: string; // customer | agent | ai | system
  senderName: string | null;
  body: string;
  createdAt: string;
};

/**
 * The customer conversation transcript, pinned above the assistant chat when a
 * thread is bound to an inbox conversation. Same bubble language as the inbox.
 */
export function ConversationTranscript({
  channelLabel,
  customerName,
  subject,
  messages,
  inboxHref,
}: {
  channelLabel: string;
  customerName: string | null;
  subject: string | null;
  messages: TranscriptMessage[];
  inboxHref: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{customerName ?? "Customer"}</span>
          <Badge variant="outline" className="capitalize">{channelLabel}</Badge>
          {subject && <span className="truncate text-xs text-muted-foreground">{subject}</span>}
        </div>
        <Link href={inboxHref} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
          Inbox <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">No messages yet.</p>
        )}
        {messages.map((m) => {
          const outbound = m.direction === "outbound";
          const internal = m.direction === "internal";
          return (
            <div key={m.id} className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm",
                  outbound
                    ? "bg-primary text-primary-foreground"
                    : internal
                      ? "bg-warning/10 text-foreground"
                      : "border border-border bg-background",
                )}
              >
                {m.body}
              </div>
              <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">
                {m.senderName ?? (m.senderType === "customer" ? customerName ?? "Customer" : "Agent")}
                {m.senderType === "ai" ? " · AI" : ""} · {relativeTime(m.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
