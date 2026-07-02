import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import type { WorkspaceContext } from "@/lib/workspace";
import { listThreads } from "@/lib/services/assistant";
import { NewThreadButton } from "@/components/cockpit/new-thread-button";

export async function ThreadListPanel({
  ctx,
  slug,
  activeId,
}: {
  ctx: WorkspaceContext;
  slug: string;
  activeId?: string;
}) {
  const threads = await listThreads(ctx, "internal_assistant");
  return (
    <div className="flex w-[300px] shrink-0 flex-col border-r bg-card">
      <div className="border-b p-3">
        <NewThreadButton slug={slug} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            No chats yet. Start one to ask Operanto about your operations.
          </p>
        )}
        {threads.map((t) => {
          const last = t.messages[0];
          return (
            <Link
              key={t.id}
              href={`/${slug}/assistant/${t.id}`}
              className={cn(
                "flex flex-col gap-0.5 border-b border-border/60 px-3 py-2.5",
                t.id === activeId ? "bg-accent" : "hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-1.5">
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{t.title}</span>
              </div>
              {last && (
                <span className="truncate pl-5 text-xs text-muted-foreground">
                  {last.role === "assistant" ? "" : "You: "}
                  {last.content || "…"}
                </span>
              )}
              <span className="pl-5 text-[11px] text-muted-foreground">{relativeTime(t.updatedAt)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
