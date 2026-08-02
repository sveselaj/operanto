import "server-only";
import type { ChannelType, ConsentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";

/**
 * Consent reads and manual corrections. Keyword-driven changes come from the
 * channel pipeline; this service is the staff-facing side. Consent rows are
 * compliance evidence — never deleted, kept through erasure and retention.
 */

export async function listCustomerConsents(ctx: OrgContext, customerId: string) {
  requirePermission(ctx.membership.role, "conversations:view_assigned");
  return prisma.consent.findMany({
    where: { ...scope(ctx), customerId },
    orderBy: { channelType: "asc" },
  });
}

export async function setConsent(
  ctx: OrgContext,
  customerId: string,
  channelType: ChannelType,
  status: ConsentStatus,
): Promise<void> {
  requirePermission(ctx.membership.role, "consent:manage");
  const customer = await prisma.customer.findFirst({
    where: { ...scope(ctx), id: customerId },
  });
  if (!customer) throw new Error("Customer not found");
  if (customer.erasedAt) throw new Error("Consent cannot be edited for an erased customer");

  const before = await prisma.consent.findUnique({
    where: {
      organisationId_customerId_channelType: {
        organisationId: ctx.organisation.id,
        customerId,
        channelType,
      },
    },
  });
  await prisma.consent.upsert({
    where: {
      organisationId_customerId_channelType: {
        organisationId: ctx.organisation.id,
        customerId,
        channelType,
      },
    },
    update: { status, source: "manual", updatedByMembershipId: ctx.membership.id },
    create: {
      organisationId: ctx.organisation.id,
      customerId,
      channelType,
      status,
      source: "manual",
      updatedByMembershipId: ctx.membership.id,
    },
  });
  await audit(ctx, {
    eventType: "consent.updated",
    targetType: "Customer",
    targetId: customerId,
    before: { channelType, status: before?.status ?? "UNKNOWN" },
    after: { channelType, status, source: "manual" },
  });
}
