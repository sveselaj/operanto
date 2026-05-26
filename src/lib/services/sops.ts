import "server-only";
import type { SopStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { runAITask } from "@/lib/ai/service";
import { generateSOPTask, type GenerateSOPOutput } from "@/lib/ai/tasks";

export async function listSOPs(
  ctx: WorkspaceContext,
  filters: { status?: SopStatus | "all" } = {},
) {
  requirePermission(ctx.member.role, "conversations:read"); // any member who can read the workspace
  const where: Prisma.SOPWhereInput = { workspaceId: ctx.workspace.id };
  if (filters.status && filters.status !== "all") where.status = filters.status;
  return prisma.sOP.findMany({
    where,
    include: { createdBy: true, approvedBy: true },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getSOP(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "conversations:read");
  return prisma.sOP.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: { createdBy: true, approvedBy: true },
  });
}

export type CreateSOPInput = {
  title: string;
  description?: string | null;
  body: string;
  category?: string | null;
};

export async function createSOP(ctx: WorkspaceContext, input: CreateSOPInput) {
  requirePermission(ctx.member.role, "sops:create");
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  const sop = await prisma.sOP.create({
    data: {
      workspaceId: ctx.workspace.id,
      title,
      description: input.description?.trim() || null,
      body: input.body,
      category: input.category?.trim() || null,
      status: "draft",
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "sop.create", entity: "SOP", entityId: sop.id });
  return sop;
}

export type UpdateSOPInput = Partial<{
  title: string;
  description: string | null;
  body: string;
  category: string | null;
}>;

export async function updateSOP(ctx: WorkspaceContext, id: string, input: UpdateSOPInput) {
  requirePermission(ctx.member.role, "sops:create");
  const existing = await prisma.sOP.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!existing) throw new Error("SOP not found");

  const data: Prisma.SOPUpdateInput = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.body !== undefined) data.body = input.body;
  if (input.category !== undefined) data.category = input.category?.trim() || null;

  // Editing an approved SOP returns it to draft and bumps the version.
  if (existing.status === "approved" && input.body !== undefined) {
    data.status = "draft";
    data.version = { increment: 1 };
    data.approvedBy = { disconnect: true };
  }

  const sop = await prisma.sOP.update({ where: { id }, data });
  await audit(ctx, { action: "sop.update", entity: "SOP", entityId: id });
  return sop;
}

export async function setSOPStatus(ctx: WorkspaceContext, id: string, status: SopStatus) {
  // Approving requires the approve permission; archiving requires create.
  requirePermission(ctx.member.role, status === "approved" ? "sops:approve" : "sops:create");
  const existing = await prisma.sOP.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!existing) throw new Error("SOP not found");

  const sop = await prisma.sOP.update({
    where: { id },
    data: {
      status,
      approvedByUserId: status === "approved" ? ctx.userId : existing.approvedByUserId,
    },
  });
  await audit(ctx, {
    action: `sop.${status}`,
    entity: "SOP",
    entityId: id,
    before: { status: existing.status },
    after: { status },
  });
  return sop;
}

/** Format the structured AI output into a readable SOP body (markdown). */
function formatSOPBody(o: GenerateSOPOutput): string {
  const lines: string[] = [];
  lines.push(`## Purpose`, o.purpose, "");
  lines.push(`## When to use`, o.whenToUse, "");
  lines.push(`## Steps`);
  o.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");
  if (o.escalationRules) lines.push(`## Escalation`, o.escalationRules, "");
  if (o.examples.length) {
    lines.push(`## Examples`);
    o.examples.forEach((e) => lines.push(`- ${e}`));
    lines.push("");
  }
  if (o.qualityChecklist.length) {
    lines.push(`## Quality checklist`);
    o.qualityChecklist.forEach((q) => lines.push(`- [ ] ${q}`));
    lines.push("");
  }
  if (o.commonMistakes.length) {
    lines.push(`## Common mistakes`);
    o.commonMistakes.forEach((m) => lines.push(`- ${m}`));
  }
  return lines.join("\n");
}

/** Generate a draft SOP with AI and persist it as a draft. */
export async function generateSOPDraft(
  ctx: WorkspaceContext,
  input: { topic: string; businessType?: string; desiredOutcome?: string },
) {
  requirePermission(ctx.member.role, "sops:create");
  const { data } = await runAITask(ctx, generateSOPTask, {
    topic: input.topic,
    businessType: input.businessType ?? null,
    desiredOutcome: input.desiredOutcome ?? null,
    examples: null,
  });

  const sop = await prisma.sOP.create({
    data: {
      workspaceId: ctx.workspace.id,
      title: data.title,
      description: data.description,
      category: data.category,
      body: formatSOPBody(data),
      status: "draft",
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "sop.generate", entity: "SOP", entityId: sop.id });
  return sop;
}
