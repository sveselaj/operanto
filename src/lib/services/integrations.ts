import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { processInboundEvent } from "@/lib/events/process";

/** Integration health + administration. Secrets are never returned to the UI. */

export async function getPronatonaIntegration(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "integrations:manage");
  const integration = await prisma.integration.findFirst({
    where: { ...scope(ctx), type: "PRONATONA" },
  });
  if (!integration) return null;
  // Strip the ciphertext before anything leaves the service layer.
  const { webhookSecretEncrypted, ...safe } = integration;
  void webhookSecretEncrypted;
  return safe;
}

export async function getIntegrationHealth(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "integrations:manage");
  const integration = await getPronatonaIntegration(ctx);
  if (!integration) return null;

  const where = { ...scope(ctx), integrationId: integration.id };
  const [byStatus, byType, recent] = await Promise.all([
    prisma.inboundEvent.groupBy({
      by: ["processingStatus"],
      where,
      _count: { _all: true },
    }),
    prisma.inboundEvent.groupBy({
      by: ["eventType"],
      where,
      _count: { _all: true },
    }),
    prisma.inboundEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: 25,
      select: {
        id: true,
        eventId: true,
        eventType: true,
        processingStatus: true,
        attemptCount: true,
        lastError: true,
        occurredAt: true,
        receivedAt: true,
        processedAt: true,
      },
    }),
  ]);

  const counts = Object.fromEntries(
    byStatus.map((row) => [row.processingStatus, row._count._all]),
  );
  return {
    integration,
    counts: {
      received: counts.RECEIVED ?? 0,
      processing: counts.PROCESSING ?? 0,
      processed: counts.PROCESSED ?? 0,
      failed: counts.FAILED ?? 0,
      deadLetter: counts.DEAD_LETTER ?? 0,
    },
    eventTypes: byType
      .map((row) => ({ eventType: row.eventType, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    recent,
  };
}

/** Admin-triggered retry of a single failed/dead-letter event. */
export async function retryEvent(ctx: OrgContext, inboundEventId: string) {
  requirePermission(ctx.membership.role, "integrations:manage");
  const event = await prisma.inboundEvent.findFirst({
    where: { ...scope(ctx), id: inboundEventId },
  });
  if (!event) throw new Error("Event not found");

  // Dead-letter retry is an explicit admin decision: reset the counter.
  if (event.processingStatus === "DEAD_LETTER") {
    await prisma.inboundEvent.update({
      where: { id: event.id },
      data: { processingStatus: "FAILED", attemptCount: 0 },
    });
  }
  const outcome = await processInboundEvent(event.id, { allowStale: true });
  await audit(ctx, {
    eventType: "integration.event_retried",
    targetType: "InboundEvent",
    targetId: event.id,
    after: { outcome },
  });
  return outcome;
}

/** Rotate the shared webhook secret. Returns nothing — the new secret is provided BY the admin. */
export async function rotateWebhookSecret(
  ctx: OrgContext,
  integrationId: string,
  newSecret: string,
) {
  requirePermission(ctx.membership.role, "integrations:manage");
  if (newSecret.length < 32) {
    throw new Error("Secret must be at least 32 characters");
  }
  const integration = await prisma.integration.findFirst({
    where: { ...scope(ctx), id: integrationId },
  });
  if (!integration) throw new Error("Integration not found");
  await prisma.integration.update({
    where: { id: integration.id },
    data: { webhookSecretEncrypted: encryptSecret(newSecret) },
  });
  await audit(ctx, {
    eventType: "integration.secret_rotated",
    targetType: "Integration",
    targetId: integration.id,
  });
}

export async function setIntegrationStatus(
  ctx: OrgContext,
  integrationId: string,
  status: "ACTIVE" | "DISABLED",
) {
  requirePermission(ctx.membership.role, "integrations:manage");
  const integration = await prisma.integration.findFirst({
    where: { ...scope(ctx), id: integrationId },
  });
  if (!integration) throw new Error("Integration not found");
  await prisma.integration.update({
    where: { id: integration.id },
    data: { status },
  });
  await audit(ctx, {
    eventType: status === "ACTIVE" ? "integration.enabled" : "integration.disabled",
    targetType: "Integration",
    targetId: integration.id,
    before: { status: integration.status },
    after: { status },
  });
}

/** Staff identity mappings (Pronatona staff ↔ Operanto membership). */
export async function listStaffMappings(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "integrations:manage");
  return prisma.externalIdentityMapping.findMany({
    where: { ...scope(ctx), sourceEntityType: "staff" },
    orderBy: { createdAt: "asc" },
  });
}

export async function upsertStaffMapping(
  ctx: OrgContext,
  input: { sourceSystem: string; sourceStaffId: string; membershipId: string },
) {
  requirePermission(ctx.membership.role, "integrations:manage");
  const member = await prisma.membership.findFirst({
    where: { id: input.membershipId, ...scope(ctx) },
  });
  if (!member) throw new Error("Membership not found in this organisation");
  await prisma.externalIdentityMapping.upsert({
    where: {
      organisationId_sourceSystem_sourceEntityType_sourceEntityId: {
        organisationId: ctx.organisation.id,
        sourceSystem: input.sourceSystem,
        sourceEntityType: "staff",
        sourceEntityId: input.sourceStaffId,
      },
    },
    create: {
      organisationId: ctx.organisation.id,
      sourceSystem: input.sourceSystem,
      sourceEntityType: "staff",
      sourceEntityId: input.sourceStaffId,
      operantoEntityType: "membership",
      operantoEntityId: input.membershipId,
    },
    update: { operantoEntityType: "membership", operantoEntityId: input.membershipId },
  });
  await audit(ctx, {
    eventType: "integration.staff_mapping_upserted",
    targetType: "ExternalIdentityMapping",
    after: { sourceStaffId: input.sourceStaffId, membershipId: input.membershipId },
  });
}
