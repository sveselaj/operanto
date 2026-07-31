import { PenLine } from "lucide-react";
import type { ContentStatus } from "@prisma/client";
import { requireWorkspace } from "@/lib/workspace";
import { listContent } from "@/lib/services/content";
import { listBrandVoices } from "@/lib/services/brand-voices";
import { PageHeader } from "@/components/layout/page-header";
import { StudioHeaderActions } from "@/components/studio/studio-header-actions";
import { ContentCard, type ContentCardData } from "@/components/studio/content-card";

const COLUMNS: { status: ContentStatus; label: string }[] = [
  { status: "idea", label: "Ideas" },
  { status: "draft", label: "Drafts" },
  { status: "review", label: "Review" },
  { status: "approved", label: "Approved" },
  { status: "published", label: "Published" },
];

export default async function StudioPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const [items, voices] = await Promise.all([listContent(ctx), listBrandVoices(ctx)]);

  const voiceOptions = voices.map((v) => ({ id: v.id, name: v.name }));
  const voiceData = voices.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    tone: v.tone,
    language: v.language,
    dos: v.dos,
    donts: v.donts,
    examplePhrases: v.examplePhrases,
  }));

  const cards: ContentCardData[] = items.map((c) => ({
    id: c.id,
    title: c.title,
    channel: c.channel,
    content: c.content,
    status: c.status,
    brandVoiceId: c.brandVoiceId,
    brandVoiceName: c.brandVoice?.name ?? null,
    sourceConversationId: c.sourceConversationId,
    sourceCustomerName: c.sourceConversation?.customer?.name ?? null,
    fromInsight: !!c.sourceInsightId,
  }));

  return (
    <>
      <PageHeader
        title="Studio"
        description="Turn conversations and insights into on-brand content."
        action={<StudioHeaderActions slug={slug} voices={voiceOptions} voiceData={voiceData} />}
      />
      {cards.length === 0 ? (
        <div className="px-6 py-10">
          <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-dashed border-border py-14 text-center">
            <PenLine className="mb-3 size-8 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium">No content yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate a draft with AI, or create one manually.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid h-[calc(100%-73px)] grid-cols-2 gap-3 overflow-x-auto p-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const colItems = cards.filter((c) => c.status === col.status);
            return (
              <div key={col.status} className="flex min-w-0 flex-col rounded-xl bg-muted/40">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-sm font-medium">{col.label}</span>
                  <span className="text-xs text-muted-foreground">{colItems.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
                  {colItems.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">—</p>
                  )}
                  {colItems.map((c) => (
                    <ContentCard key={c.id} slug={slug} item={c} voices={voiceOptions} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
