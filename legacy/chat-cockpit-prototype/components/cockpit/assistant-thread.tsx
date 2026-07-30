"use client";

import { Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn, relativeTime } from "@/lib/utils";
import { CockpitBlocks } from "@/components/cockpit/cards";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ThreadMessage = {
  id: string;
  role: string;
  content: string;
  structuredContent: { blocks: any[] } | null;
  confidence: number | null;
  createdAt: string;
  authorName: string | null;
};

export function AssistantThread({
  slug,
  messages,
}: {
  slug: string;
  messages: ThreadMessage[];
}) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto bg-background px-4 py-5">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((m) => (
          <MessageRow key={m.id} slug={slug} message={m} />
        ))}
      </div>
    </div>
  );
}

export function MessageRow({ slug, message }: { slug: string; message: ThreadMessage }) {
  const isUser = message.role === "user";
  if (message.role === "system") {
    return (
      <p className="text-center text-xs text-muted-foreground">{message.content}</p>
    );
  }
  return (
    <div className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Sparkles className="size-3.5" />
        </div>
      )}
      <div className={cn("min-w-0 max-w-[85%]", isUser && "flex flex-col items-end")}>
        {message.content && (
          <div
            className={cn(
              "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
              isUser
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-foreground",
            )}
          >
            {message.content}
          </div>
        )}
        {!isUser && message.structuredContent?.blocks && (
          <CockpitBlocks blocks={message.structuredContent.blocks} slug={slug} />
        )}
        <div className={cn("mt-1 px-1 text-[11px] text-muted-foreground", isUser && "text-right")}>
          {isUser ? (message.authorName ?? "You") : "Operanto"}
          {typeof message.confidence === "number" && !isUser
            ? ` · ${Math.round(message.confidence * 100)}% confidence`
            : ""}{" "}
          · {relativeTime(message.createdAt)}
        </div>
      </div>
      {isUser && <Avatar name={message.authorName ?? "You"} className="mt-0.5 size-7" />}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
