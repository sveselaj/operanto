import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { channelLabel } from "@/lib/labels";
import { getThread } from "@/lib/services/assistant";
import { getConversationContext } from "@/lib/services/conversation-context";
import { suggestionsFor } from "@/lib/cockpit/suggestions";
import { ThreadListPanel } from "@/components/cockpit/thread-list-panel";
import { AssistantContextPanel } from "@/components/cockpit/context-panel";
import { ConversationContextPanel } from "@/components/cockpit/conversation-context-panel";
import { ConversationTranscript } from "@/components/cockpit/conversation-transcript";
import { AssistantChat } from "@/components/cockpit/assistant-chat";
import type { ThreadMessage } from "@/components/cockpit/assistant-thread";
import type { ChannelType } from "@prisma/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CONVERSATION_SUGGESTIONS = [
  "Summarize this conversation",
  "Draft a reply offering a viewing",
  "Find matching properties for this customer",
];

export default async function AssistantThreadPage({
  params,
}: {
  params: Promise<{ workspace: string; threadId: string }>;
}) {
  const { workspace: slug, threadId } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "assistant:use")) redirect(`/${slug}/command`);

  let thread;
  try {
    thread = await getThread(ctx, threadId);
  } catch {
    notFound();
  }

  const messages: ThreadMessage[] = thread.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    structuredContent: (m.structuredContent as { blocks: any[] } | null) ?? null,
    confidence: m.confidence,
    createdAt: m.createdAt.toISOString(),
    authorName: m.createdBy?.name ?? null,
  }));

  const isConversation = thread.mode === "customer_conversation" && !!thread.linkedConversationId;
  let convContext: Awaited<ReturnType<typeof getConversationContext>> | null = null;
  if (isConversation && can(ctx.member.role, "conversations:read")) {
    try {
      convContext = await getConversationContext(ctx, thread.linkedConversationId!);
    } catch {
      convContext = null;
    }
  }

  const suggestions = messages.length === 0
    ? isConversation
      ? CONVERSATION_SUGGESTIONS
      : suggestionsFor(ctx.workspace.vertical)
    : [];

  const intro =
    convContext &&
    (
      <ConversationTranscript
        channelLabel={channelLabel[convContext.conversation.channelType as ChannelType]}
        customerName={convContext.conversation.customer?.name ?? null}
        subject={convContext.conversation.subject}
        inboxHref={`/${slug}/inbox/${convContext.conversation.id}`}
        messages={convContext.conversation.messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          senderType: m.senderType,
          senderName: m.sender?.name ?? null,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    );

  return (
    <div className="flex h-full overflow-hidden">
      <ThreadListPanel ctx={ctx} slug={slug} activeId={threadId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2.5">
          <span className="truncate text-sm font-semibold">{thread.title}</span>
          {isConversation && <Badge variant="outline">Customer conversation</Badge>}
        </div>
        <AssistantChat
          slug={slug}
          threadId={threadId}
          initialMessages={messages}
          suggestions={suggestions}
          intro={intro}
        />
      </div>
      {convContext ? (
        <ConversationContextPanel slug={slug} data={convContext} />
      ) : (
        <AssistantContextPanel ctx={ctx} slug={slug} />
      )}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
