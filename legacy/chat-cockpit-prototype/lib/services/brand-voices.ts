import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";

export async function listBrandVoices(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "content:manage");
  return prisma.brandVoice.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "asc" },
  });
}

export type BrandVoiceInput = {
  name: string;
  description?: string | null;
  tone?: string | null;
  language?: string;
  dos: string[];
  donts: string[];
  examplePhrases: string[];
};

export async function createBrandVoice(ctx: WorkspaceContext, input: BrandVoiceInput) {
  requirePermission(ctx.member.role, "content:manage");
  if (!input.name.trim()) throw new Error("Name is required");
  const bv = await prisma.brandVoice.create({
    data: {
      workspaceId: ctx.workspace.id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      tone: input.tone?.trim() || null,
      language: input.language || "en",
      dos: input.dos.filter(Boolean),
      donts: input.donts.filter(Boolean),
      examplePhrases: input.examplePhrases.filter(Boolean),
    },
  });
  await audit(ctx, { action: "brandVoice.create", entity: "BrandVoice", entityId: bv.id });
  return bv;
}

export async function updateBrandVoice(
  ctx: WorkspaceContext,
  id: string,
  input: BrandVoiceInput,
) {
  requirePermission(ctx.member.role, "content:manage");
  const existing = await prisma.brandVoice.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!existing) throw new Error("Brand voice not found");
  const bv = await prisma.brandVoice.update({
    where: { id },
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      tone: input.tone?.trim() || null,
      language: input.language || existing.language,
      dos: input.dos.filter(Boolean),
      donts: input.donts.filter(Boolean),
      examplePhrases: input.examplePhrases.filter(Boolean),
    },
  });
  await audit(ctx, { action: "brandVoice.update", entity: "BrandVoice", entityId: id });
  return bv;
}

export async function deleteBrandVoice(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "content:manage");
  const existing = await prisma.brandVoice.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!existing) throw new Error("Brand voice not found");
  await prisma.brandVoice.delete({ where: { id } });
  await audit(ctx, { action: "brandVoice.delete", entity: "BrandVoice", entityId: id });
}
