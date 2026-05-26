import "server-only";
import type { ContentChannel, ContentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { runAITask } from "@/lib/ai/service";
import { generateContentTask, type BrandVoiceContext } from "@/lib/ai/tasks";

export async function listContent(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "content:manage");
  return prisma.contentDraft.findMany({
    where: { workspaceId: ctx.workspace.id },
    include: { brandVoice: true, sourceConversation: { include: { customer: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function getContent(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "content:manage");
  return prisma.contentDraft.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: { brandVoice: true },
  });
}

export type CreateContentInput = {
  title: string;
  channel: ContentChannel;
  content: string;
  brandVoiceId?: string | null;
  sourceConversationId?: string | null;
  sourceInsightId?: string | null;
  status?: ContentStatus;
};

async function assertBrandVoice(ctx: WorkspaceContext, id?: string | null) {
  if (!id) return;
  const bv = await prisma.brandVoice.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!bv) throw new Error("Brand voice not found");
}

export async function createContent(ctx: WorkspaceContext, input: CreateContentInput) {
  requirePermission(ctx.member.role, "content:manage");
  if (!input.title.trim()) throw new Error("Title is required");
  await assertBrandVoice(ctx, input.brandVoiceId);

  const draft = await prisma.contentDraft.create({
    data: {
      workspaceId: ctx.workspace.id,
      title: input.title.trim(),
      channel: input.channel,
      content: input.content,
      status: input.status ?? "idea",
      brandVoiceId: input.brandVoiceId ?? null,
      sourceConversationId: input.sourceConversationId ?? null,
      sourceInsightId: input.sourceInsightId ?? null,
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "content.create", entity: "ContentDraft", entityId: draft.id });
  return draft;
}

export type UpdateContentInput = Partial<{
  title: string;
  channel: ContentChannel;
  content: string;
  status: ContentStatus;
  brandVoiceId: string | null;
}>;

export async function updateContent(ctx: WorkspaceContext, id: string, input: UpdateContentInput) {
  requirePermission(ctx.member.role, "content:manage");
  const existing = await prisma.contentDraft.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!existing) throw new Error("Content not found");
  await assertBrandVoice(ctx, input.brandVoiceId);

  const data: Prisma.ContentDraftUpdateInput = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.channel !== undefined) data.channel = input.channel;
  if (input.content !== undefined) data.content = input.content;
  if (input.status !== undefined) data.status = input.status;
  if (input.brandVoiceId !== undefined)
    data.brandVoice = input.brandVoiceId
      ? { connect: { id: input.brandVoiceId } }
      : { disconnect: true };

  const draft = await prisma.contentDraft.update({ where: { id }, data });
  await audit(ctx, { action: "content.update", entity: "ContentDraft", entityId: id });
  return draft;
}

export async function deleteContent(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "content:manage");
  const existing = await prisma.contentDraft.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!existing) throw new Error("Content not found");
  await prisma.contentDraft.delete({ where: { id } });
  await audit(ctx, { action: "content.delete", entity: "ContentDraft", entityId: id });
}

// ── AI generation ─────────────────────────────────────────────

function brandVoiceContext(bv: {
  tone: string | null;
  dos: string[];
  donts: string[];
  examplePhrases: string[];
}): BrandVoiceContext {
  return { tone: bv.tone, dos: bv.dos, donts: bv.donts, examplePhrases: bv.examplePhrases };
}

/** Compose the persisted content body from structured AI output. */
function composeBody(o: {
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
}): string {
  const tags = o.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return [o.hook, "", o.caption, "", o.cta, tags ? `\n${tags}` : ""].join("\n").trim();
}

type GenerateOptions = {
  channel: ContentChannel;
  goal: string;
  brandVoiceId?: string | null;
  sourceConversationId?: string | null;
  sourceInsightId?: string | null;
  sourceText?: string | null;
};

/** Core generator: run the AI task and persist a draft. */
async function generateAndPersist(ctx: WorkspaceContext, opts: GenerateOptions) {
  requirePermission(ctx.member.role, "content:manage");

  let brandVoice: BrandVoiceContext | null = null;
  let brandVoiceId = opts.brandVoiceId ?? null;
  if (brandVoiceId) {
    const bv = await prisma.brandVoice.findFirst({
      where: { id: brandVoiceId, workspaceId: ctx.workspace.id },
    });
    if (!bv) throw new Error("Brand voice not found");
    brandVoice = brandVoiceContext(bv);
  } else {
    const bv = await prisma.brandVoice.findFirst({ where: { workspaceId: ctx.workspace.id } });
    if (bv) {
      brandVoice = brandVoiceContext(bv);
      brandVoiceId = bv.id;
    }
  }

  const { data } = await runAITask(ctx, generateContentTask, {
    channel: opts.channel,
    goal: opts.goal,
    sourceText: opts.sourceText ?? null,
    brandVoice,
  });

  const draft = await prisma.contentDraft.create({
    data: {
      workspaceId: ctx.workspace.id,
      title: data.title || opts.goal.slice(0, 60),
      channel: opts.channel,
      content: composeBody(data),
      status: "draft",
      brandVoiceId,
      sourceConversationId: opts.sourceConversationId ?? null,
      sourceInsightId: opts.sourceInsightId ?? null,
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "content.generate", entity: "ContentDraft", entityId: draft.id });
  return draft;
}

export async function generateContentDraft(
  ctx: WorkspaceContext,
  opts: { channel: ContentChannel; goal: string; brandVoiceId?: string | null },
) {
  return generateAndPersist(ctx, opts);
}

export async function generateFromConversation(
  ctx: WorkspaceContext,
  conversationId: string,
  channel: ContentChannel,
) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspace.id },
    include: {
      customer: true,
      messages: { where: { direction: "inbound" }, orderBy: { createdAt: "asc" }, take: 10 },
    },
  });
  if (!conv) throw new Error("Conversation not found");

  const sourceText = conv.messages.map((m) => `Customer: ${m.body}`).join("\n");
  return generateAndPersist(ctx, {
    channel,
    goal: `Create a post inspired by this customer conversation${conv.subject ? ` about "${conv.subject}"` : ""}.`,
    sourceConversationId: conversationId,
    sourceText,
  });
}

export async function generateFromInsight(
  ctx: WorkspaceContext,
  insightId: string,
  channel: ContentChannel,
) {
  const insight = await prisma.insight.findFirst({
    where: { id: insightId, workspaceId: ctx.workspace.id },
  });
  if (!insight) throw new Error("Insight not found");

  return generateAndPersist(ctx, {
    channel,
    goal: insight.title,
    sourceInsightId: insightId,
    sourceText: insight.description ?? insight.title,
  });
}
