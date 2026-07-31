import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { suggestionsFor } from "@/lib/cockpit/suggestions";
import { ThreadListPanel } from "@/components/cockpit/thread-list-panel";
import { AssistantContextPanel } from "@/components/cockpit/context-panel";
import { AssistantLauncher } from "@/components/cockpit/assistant-launcher";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "assistant:use")) redirect(`/${slug}/command`);
  const suggestions = suggestionsFor(ctx.workspace.vertical);

  return (
    <div className="flex h-full overflow-hidden">
      <ThreadListPanel ctx={ctx} slug={slug} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <AssistantLauncher slug={slug} suggestions={suggestions} />
      </div>
      <AssistantContextPanel ctx={ctx} slug={slug} />
    </div>
  );
}
