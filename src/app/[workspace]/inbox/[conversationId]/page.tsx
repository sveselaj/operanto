import { notFound } from "next/navigation";
import { Sparkles, StickyNote } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import {
  getConversation,
  listAssignableMembers,
  listWorkspaceTags,
} from "@/lib/services/conversations";
import { parseConversationFilters } from "@/lib/inbox-filters";
import { cn, relativeTime } from "@/lib/utils";
import {
  channelLabel,
  intentLabel,
  sentimentLabel,
} from "@/lib/labels";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ConversationListPanel } from "@/components/inbox/conversation-list-panel";
import { ConversationControls } from "@/components/inbox/conversation-controls";
import { ReplyComposer } from "@/components/inbox/reply-composer";
import { TagEditor } from "@/components/inbox/tag-editor";
import { AddNoteForm } from "@/components/inbox/add-note-form";
import { AnalyzeButton } from "@/components/inbox/analyze-button";
import { CreateTaskButton } from "@/components/inbox/create-task-button";
import { GenerateContentButton } from "@/components/inbox/generate-content-button";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: slug, conversationId } = await params;
  const filters = parseConversationFilters(await searchParams);

  const ctx = await requireWorkspace(slug);
  const conversation = await getConversation(ctx, conversationId);
  if (!conversation) notFound();

  const [members, tags] = await Promise.all([
    listAssignableMembers(ctx),
    listWorkspaceTags(ctx),
  ]);

  const canTriage = can(ctx.member.role, "conversations:triage");
  const canReply = can(ctx.member.role, "conversations:reply");

  return (
    <div className="flex h-full overflow-hidden">
      <ConversationListPanel slug={slug} filters={filters} activeId={conversationId} />

      {/* Center: thread + composer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-2 border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={conversation.customer?.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold">
                  {conversation.customer?.name ?? "Unknown customer"}
                </h2>
                <Badge variant="default">{channelLabel[conversation.channelType]}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {conversation.subject ?? "No subject"}
              </p>
            </div>
          </div>
          <ConversationControls
            slug={slug}
            conversationId={conversation.id}
            status={conversation.status}
            priority={conversation.priority}
            assigneeId={conversation.assignedToUserId}
            members={members.map((m) => ({ id: m.userId, name: m.user.name }))}
            canTriage={canTriage}
          />
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-background px-5 py-4">
          {conversation.messages.map((m) => {
            const outbound = m.direction === "outbound";
            const internal = m.direction === "internal";
            return (
              <div
                key={m.id}
                className={cn("flex flex-col", outbound ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                    outbound
                      ? "bg-primary text-primary-foreground"
                      : internal
                        ? "bg-warning/10 text-foreground"
                        : "bg-card text-foreground border border-border",
                  )}
                >
                  {m.body}
                </div>
                <span className="mt-1 px-1 text-[11px] text-muted-foreground">
                  {outbound
                    ? (m.sender?.name ?? "Agent")
                    : (conversation.customer?.name ?? "Customer")}
                  {m.senderType === "ai" && " · AI"} · {relativeTime(m.createdAt)}
                </span>
              </div>
            );
          })}
        </div>

        <ReplyComposer slug={slug} conversationId={conversation.id} canReply={canReply} />
      </div>

      {/* Right: context panel */}
      <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card px-4 py-4 xl:flex">
        {/* AI summary */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" /> AI summary
            </div>
            <AnalyzeButton
              slug={slug}
              conversationId={conversation.id}
              hasSummary={!!conversation.summary}
            />
          </div>
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="text-foreground">
              {conversation.summary ?? "No summary yet. Click Analyze to summarize and classify."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {conversation.intent && (
                <Badge variant="primary">{intentLabel[conversation.intent]}</Badge>
              )}
              {conversation.sentiment && (
                <Badge variant="outline">{sentimentLabel[conversation.sentiment]}</Badge>
              )}
              {typeof conversation.leadScore === "number" && (
                <Badge variant="warning">Lead score {conversation.leadScore}</Badge>
              )}
            </div>
          </div>
        </section>

        {/* Quick actions */}
        <div className="space-y-2">
          {can(ctx.member.role, "tasks:manage") && (
            <CreateTaskButton
              slug={slug}
              conversationId={conversation.id}
              customerId={conversation.customerId}
              customerName={conversation.customer?.name ?? null}
              members={members.map((m) => ({ id: m.userId, name: m.user.name }))}
            />
          )}
          {can(ctx.member.role, "content:manage") && (
            <GenerateContentButton slug={slug} conversationId={conversation.id} />
          )}
        </div>

        {/* Customer */}
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Customer
          </div>
          <dl className="space-y-1.5 text-sm">
            <Row label="Name" value={conversation.customer?.name} />
            <Row label="Email" value={conversation.customer?.email} />
            <Row label="Phone" value={conversation.customer?.phone} />
            <Row label="Language" value={conversation.customer?.language} />
            <Row label="Location" value={conversation.customer?.location} />
          </dl>
        </section>

        {/* Tags */}
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tags
          </div>
          <TagEditor
            slug={slug}
            conversationId={conversation.id}
            allTags={tags}
            selectedIds={conversation.tags.map((t) => t.tagId)}
            canEdit={canTriage}
          />
        </section>

        {/* Internal notes */}
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <StickyNote className="size-3.5" /> Internal notes
          </div>
          <div className="mb-2 space-y-2">
            {conversation.internalNotes.length === 0 && (
              <p className="text-xs text-muted-foreground">No notes yet.</p>
            )}
            {conversation.internalNotes.map((n) => (
              <div key={n.id} className="rounded-lg bg-warning/10 p-2.5 text-xs">
                <p className="text-foreground">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {n.user.name} · {relativeTime(n.createdAt)}
                </p>
              </div>
            ))}
          </div>
          <AddNoteForm slug={slug} conversationId={conversation.id} />
        </section>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value || "—"}</dd>
    </div>
  );
}
