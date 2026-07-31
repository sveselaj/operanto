import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { WidgetChat } from "@/components/widget/widget-chat";

/**
 * Public, standalone web-chat widget. No authentication — gated by the
 * unguessable channel account id. Messages create real inbound conversations.
 */
export default async function WidgetPage({
  params,
}: {
  params: Promise<{ channelAccountId: string }>;
}) {
  const { channelAccountId } = await params;
  const account = await prisma.channelAccount.findUnique({
    where: { id: channelAccountId },
    include: { workspace: true },
  });
  if (!account || account.type !== "webchat") notFound();

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <WidgetChat channelAccountId={account.id} brandName={account.workspace.name} />
    </div>
  );
}
