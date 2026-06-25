import "server-only";
import type { Prisma, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { ruleDefinitionSchema } from "@/lib/business-rules";

/**
 * Catalogue service — per-workspace Products and BusinessRules. Generic and
 * config-driven: the vertical's offering + pricing/eligibility policy as data.
 */

// ── Products ───────────────────────────────────────────────────

export function listProducts(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "catalog:manage");
  return prisma.product.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Active products usable as quote lines — readable by anyone who can quote. */
export function listSellableProducts(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "quotes:manage");
  return prisma.product.findMany({
    where: { workspaceId: ctx.workspace.id, active: true },
    orderBy: { name: "asc" },
  });
}

export type ProductInput = {
  name: string;
  type: ProductType;
  sku?: string | null;
  description?: string | null;
  unitPrice?: number | null;
  taxRate?: number | null;
  unit?: string | null;
  active?: boolean;
};

export async function createProduct(ctx: WorkspaceContext, input: ProductInput) {
  requirePermission(ctx.member.role, "catalog:manage");
  const name = input.name.trim();
  if (!name) throw new Error("Product name is required");
  const product = await prisma.product.create({
    data: {
      workspaceId: ctx.workspace.id,
      name,
      type: input.type,
      sku: input.sku?.trim() || null,
      description: input.description ?? null,
      unitPrice: input.unitPrice ?? null,
      currency: ctx.workspace.defaultCurrency,
      taxRate: input.taxRate ?? ctx.workspace.defaultTaxRate,
      unit: input.unit?.trim() || null,
      active: input.active ?? true,
    },
  });
  await audit(ctx, { action: "product.create", entity: "Product", entityId: product.id });
  return product;
}

export async function updateProduct(ctx: WorkspaceContext, id: string, input: ProductInput) {
  requirePermission(ctx.member.role, "catalog:manage");
  await assertProduct(ctx, id);
  const product = await prisma.product.update({
    where: { id },
    data: {
      name: input.name.trim(),
      type: input.type,
      sku: input.sku?.trim() || null,
      description: input.description ?? null,
      unitPrice: input.unitPrice ?? null,
      taxRate: input.taxRate ?? ctx.workspace.defaultTaxRate,
      unit: input.unit?.trim() || null,
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  await audit(ctx, { action: "product.update", entity: "Product", entityId: id });
  return product;
}

export async function setProductActive(ctx: WorkspaceContext, id: string, active: boolean) {
  requirePermission(ctx.member.role, "catalog:manage");
  await assertProduct(ctx, id);
  await prisma.product.update({ where: { id }, data: { active } });
  await audit(ctx, { action: "product.active", entity: "Product", entityId: id, after: { active } });
}

export async function deleteProduct(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "catalog:manage");
  await assertProduct(ctx, id);
  await prisma.product.delete({ where: { id } });
  await audit(ctx, { action: "product.delete", entity: "Product", entityId: id });
}

async function assertProduct(ctx: WorkspaceContext, id: string) {
  const p = await prisma.product.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!p) throw new Error("Product not found");
}

// ── Business rules ─────────────────────────────────────────────

export function listBusinessRules(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "catalog:manage");
  return prisma.businessRule.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: [{ enabled: "desc" }, { priority: "asc" }],
  });
}

export type BusinessRuleInput = {
  name: string;
  priority?: number;
  enabled?: boolean;
  definition: unknown;
};

function validatedDefinition(definition: unknown): { type: string; definition: Prisma.InputJsonValue } {
  const parsed = ruleDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    throw new Error(`Invalid rule: ${parsed.error.issues[0]?.message ?? "bad definition"}`);
  }
  return { type: parsed.data.type, definition: parsed.data as Prisma.InputJsonValue };
}

export async function createBusinessRule(ctx: WorkspaceContext, input: BusinessRuleInput) {
  requirePermission(ctx.member.role, "catalog:manage");
  const name = input.name.trim();
  if (!name) throw new Error("Rule name is required");
  const { type, definition } = validatedDefinition(input.definition);
  const rule = await prisma.businessRule.create({
    data: {
      workspaceId: ctx.workspace.id,
      name,
      type,
      priority: input.priority ?? 0,
      enabled: input.enabled ?? true,
      definition,
    },
  });
  await audit(ctx, { action: "rule.create", entity: "BusinessRule", entityId: rule.id });
  return rule;
}

export async function setBusinessRuleEnabled(ctx: WorkspaceContext, id: string, enabled: boolean) {
  requirePermission(ctx.member.role, "catalog:manage");
  await assertRule(ctx, id);
  await prisma.businessRule.update({ where: { id }, data: { enabled } });
  await audit(ctx, { action: "rule.enabled", entity: "BusinessRule", entityId: id, after: { enabled } });
}

export async function deleteBusinessRule(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "catalog:manage");
  await assertRule(ctx, id);
  await prisma.businessRule.delete({ where: { id } });
  await audit(ctx, { action: "rule.delete", entity: "BusinessRule", entityId: id });
}

async function assertRule(ctx: WorkspaceContext, id: string) {
  const r = await prisma.businessRule.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!r) throw new Error("Business rule not found");
}
