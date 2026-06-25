import "server-only";
import type { ChannelType, MessageTemplate, TemplateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { extractTemplateVariables, renderTemplate } from "./templates-render";

/**
 * MediaSync — reusable outbound message templates.
 *
 * Templates cover first-contact / out-of-window sends (e.g. WhatsApp's 24h
 * customer-care window). Declared `{{variables}}` are derived from the body on
 * write, so the editor never drifts from the placeholders actually used.
 */

export function listTemplates(ctx: WorkspaceContext): Promise<MessageTemplate[]> {
  requirePermission(ctx.member.role, "conversations:read");
  return prisma.messageTemplate.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export function getTemplate(ctx: WorkspaceContext, id: string): Promise<MessageTemplate | null> {
  requirePermission(ctx.member.role, "conversations:read");
  return prisma.messageTemplate.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
}

export type TemplateInput = {
  name: string;
  channelType: ChannelType;
  category?: string | null;
  language?: string;
  body: string;
};

export async function createTemplate(
  ctx: WorkspaceContext,
  input: TemplateInput,
): Promise<MessageTemplate> {
  requirePermission(ctx.member.role, "messaging:manage");
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) throw new Error("Template name is required");
  if (!body) throw new Error("Template body is required");

  const template = await prisma.messageTemplate.create({
    data: {
      workspaceId: ctx.workspace.id,
      name,
      channelType: input.channelType,
      category: input.category ?? null,
      language: input.language ?? ctx.workspace.defaultLanguage,
      body,
      variables: extractTemplateVariables(body),
      status: "draft",
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "template.create", entity: "MessageTemplate", entityId: template.id });
  return template;
}

export async function updateTemplate(
  ctx: WorkspaceContext,
  id: string,
  input: TemplateInput,
): Promise<MessageTemplate> {
  requirePermission(ctx.member.role, "messaging:manage");
  await assertTemplate(ctx, id);
  const body = input.body.trim();
  const template = await prisma.messageTemplate.update({
    where: { id },
    data: {
      name: input.name.trim(),
      channelType: input.channelType,
      category: input.category ?? null,
      language: input.language ?? ctx.workspace.defaultLanguage,
      body,
      variables: extractTemplateVariables(body),
    },
  });
  await audit(ctx, { action: "template.update", entity: "MessageTemplate", entityId: id });
  return template;
}

export async function setTemplateStatus(
  ctx: WorkspaceContext,
  id: string,
  status: TemplateStatus,
): Promise<void> {
  requirePermission(ctx.member.role, "messaging:manage");
  await assertTemplate(ctx, id);
  await prisma.messageTemplate.update({
    where: { id },
    data: { status, approvedByUserId: status === "approved" ? ctx.userId : undefined },
  });
  await audit(ctx, {
    action: "template.status",
    entity: "MessageTemplate",
    entityId: id,
    after: { status },
  });
}

export async function deleteTemplate(ctx: WorkspaceContext, id: string): Promise<void> {
  requirePermission(ctx.member.role, "messaging:manage");
  await assertTemplate(ctx, id);
  await prisma.messageTemplate.delete({ where: { id } });
  await audit(ctx, { action: "template.delete", entity: "MessageTemplate", entityId: id });
}

/**
 * Render an approved template by id against variable values. Throws if the
 * template is missing, not approved, or any declared variable is unfilled.
 */
export async function renderTemplateById(
  workspaceId: string,
  templateId: string,
  vars: Record<string, string | number | null | undefined>,
): Promise<{ template: MessageTemplate; text: string }> {
  const template = await prisma.messageTemplate.findFirst({
    where: { id: templateId, workspaceId },
  });
  if (!template) throw new Error("Template not found");
  if (template.status !== "approved") throw new Error("Template is not approved for sending");
  const { text, missing } = renderTemplate(template.body, vars);
  if (missing.length) throw new Error(`Missing template values: ${missing.join(", ")}`);
  return { template, text };
}

async function assertTemplate(ctx: WorkspaceContext, id: string) {
  const t = await prisma.messageTemplate.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!t) throw new Error("Template not found");
  return t;
}
