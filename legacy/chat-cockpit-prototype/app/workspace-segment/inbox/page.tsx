import { Inbox } from "lucide-react";
import { ConversationListPanel } from "@/components/inbox/conversation-list-panel";
import { parseConversationFilters } from "@/lib/inbox-filters";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await params;
  const filters = parseConversationFilters(await searchParams);

  return (
    <div className="flex h-full overflow-hidden">
      <ConversationListPanel slug={workspace} filters={filters} />
      <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
        <Inbox className="mb-3 size-8 opacity-40" />
        <p className="text-sm">Select a conversation to get started.</p>
      </div>
    </div>
  );
}
