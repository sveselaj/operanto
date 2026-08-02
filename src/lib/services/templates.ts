import "server-only";
import type { TemplateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";

/**
 * Organisation-authorized WhatsApp message templates. Rows mirror templates
 * approved in Meta Business Manager — administration is manual in this slice
 * (no provider sync) and audited. Only APPROVED rows are selectable by the
 * send operation, and only ever by id within the organisation scope; a
 * client-provided template NAME is never trusted.
 */

export async function listTemplates(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "templates:manage");
  return prisma.messageTemplate.findMany({
    where: scope(ctx),
    orderBy: [{ name: "asc" }, { language: "asc" }],
  });
}

/** Approved templates only — what the send panel may offer. */
export async function listApprovedTemplates(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "messages:send");
  return prisma.messageTemplate.findMany({
    where: { ...scope(ctx), status: "APPROVED" },
    orderBy: [{ name: "asc" }, { language: "asc" }],
  });
}

export async function createTemplate(
  ctx: OrgContext,
  input: { name: string; language: string; body: string },
) {
  requirePermission(ctx.membership.role, "templates:manage");
  const name = input.name.trim();
  const language = input.language.trim();
  const body = input.body.trim();
  if (!name || !language || !body) throw new Error("Name, language and body are required");
  const template = await prisma.messageTemplate.create({
    data: { organisationId: ctx.organisation.id, name, language, body },
  });
  await audit(ctx, {
    eventType: "template.created",
    targetType: "MessageTemplate",
    targetId: template.id,
    after: { name, language, status: template.status },
  });
  return template;
}

export async function setTemplateStatus(
  ctx: OrgContext,
  templateId: string,
  status: TemplateStatus,
) {
  requirePermission(ctx.membership.role, "templates:manage");
  const template = await prisma.messageTemplate.findFirst({
    where: { ...scope(ctx), id: templateId },
  });
  if (!template) throw new Error("Template not found");
  await prisma.messageTemplate.update({
    where: { id: template.id },
    data: { status },
  });
  await audit(ctx, {
    eventType: "template.status_changed",
    targetType: "MessageTemplate",
    targetId: template.id,
    before: { status: template.status },
    after: { status },
  });
}
