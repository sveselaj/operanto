import "server-only";
import { prisma } from "@/lib/prisma";
import type { WorkspaceContext } from "@/lib/workspace";
import { audit } from "@/lib/audit";
import { runAITask } from "@/lib/ai/service";
import { extractRequirementsTask, requestInfoTask } from "@/lib/ai/tasks";
import type { BrandVoiceContext } from "@/lib/ai/tasks";
import { requirementProgress } from "@/lib/opportunity-progress";
import { upsertRequirement } from "@/lib/services/opportunities";

/** Load the conversation context + brand voice for an opportunity. */
async function buildContext(ctx: WorkspaceContext, opportunityId: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: ctx.workspace.id },
    include: {
      customer: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
      },
    },
  });
  if (!opp) throw new Error("Opportunity not found");

  // Prefer the primary conversation; fall back to the most recent linked one.
  const conv =
    opp.conversations.find((c) => c.id === opp.primaryConversationId) ?? opp.conversations[0];

  const brandVoiceRow = await prisma.brandVoice.findFirst({
    where: { workspaceId: ctx.workspace.id },
  });
  const brandVoice: BrandVoiceContext | null = brandVoiceRow
    ? {
        tone: brandVoiceRow.tone,
        dos: brandVoiceRow.dos,
        donts: brandVoiceRow.donts,
        examplePhrases: brandVoiceRow.examplePhrases,
      }
    : null;

  return {
    opp,
    conv,
    brandVoice,
    customerName: opp.customer?.name ?? null,
    channel: conv?.channelType ?? "manual",
    messages: (conv?.messages ?? [])
      .filter((m) => m.direction !== "internal")
      .map((m) => ({
        role: m.direction === "inbound" ? ("customer" as const) : ("agent" as const),
        body: m.body,
      })),
  };
}

/**
 * Extract qualification requirements from the opportunity's conversation and
 * upsert them. Provided values land as `provided`; gaps as `missing`.
 */
export async function extractRequirements(ctx: WorkspaceContext, opportunityId: string) {
  const c = await buildContext(ctx, opportunityId);
  if (c.messages.length === 0) throw new Error("No conversation messages to extract from yet");

  const res = await runAITask(ctx, extractRequirementsTask, {
    channel: c.channel,
    subject: c.conv?.subject ?? null,
    customerName: c.customerName,
    brandVoice: c.brandVoice,
    messages: c.messages,
  });

  for (const r of res.data.requirements) {
    await upsertRequirement(ctx, opportunityId, {
      key: r.key,
      label: r.label,
      valueType: r.valueType,
      value: r.value,
      required: r.required,
      confidence: r.confidence,
    });
  }

  await audit(ctx, {
    action: "opportunity.extract",
    entity: "Opportunity",
    entityId: opportunityId,
    after: { count: res.data.requirements.length },
  });

  return { count: res.data.requirements.length };
}

/**
 * Determine what required information is still missing and draft a message
 * asking the customer for it. The draft is never sent automatically.
 */
export async function detectMissingInfo(ctx: WorkspaceContext, opportunityId: string) {
  const reqs = await prisma.customerRequirement.findMany({
    where: { opportunityId, workspaceId: ctx.workspace.id },
    select: { label: true, status: true, required: true },
  });
  const progress = requirementProgress(reqs);
  if (progress.complete) {
    return { complete: true as const, missingLabels: [] as string[], message: null };
  }

  const c = await buildContext(ctx, opportunityId);
  const res = await runAITask(ctx, requestInfoTask, {
    channel: c.channel,
    customerName: c.customerName,
    brandVoice: c.brandVoice,
    missingLabels: progress.missingRequired,
  });

  return {
    complete: false as const,
    missingLabels: progress.missingRequired,
    message: res.data.message,
  };
}
