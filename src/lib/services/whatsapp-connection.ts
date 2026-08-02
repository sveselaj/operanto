import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { getChannelAdapter } from "@/lib/channels/registry";

/**
 * WhatsApp Cloud connection administration. Each organisation connects its
 * OWN WhatsApp Business Account and phone number under the one
 * Operanto-managed Meta application.
 *
 * Credential rules: the access token is encrypted (AES-256-GCM under
 * OPERANTO_ENCRYPTION_KEY) before it touches the database, is never returned
 * from any function here, and never appears in audit metadata. The Meta app
 * secret and webhook verify token are deployment-level environment values
 * and are never stored per organisation.
 *
 * Stage gates: inboundEnabled / outboundEnabled both default OFF and are
 * flipped separately, matching the activation order (connect → verify →
 * inbound-only → outbound pilot). Deployment-level flags gate on top.
 */

export type WhatsAppConnectionInput = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  accessToken: string;
};

export async function connectWhatsApp(
  ctx: OrgContext,
  input: WhatsAppConnectionInput,
): Promise<{ connectionId: string; verified: boolean; detail: string | null }> {
  requirePermission(ctx.membership.role, "channels:connect");
  const wabaId = input.wabaId.trim();
  const phoneNumberId = input.phoneNumberId.trim();
  const displayPhoneNumber = input.displayPhoneNumber.trim();
  const accessToken = input.accessToken.trim();
  if (!wabaId || !phoneNumberId || !displayPhoneNumber || !accessToken) {
    throw new Error("All WhatsApp connection fields are required");
  }

  // The phone number id is the authoritative routing key — refuse to claim
  // one already registered to ANY organisation rather than reassign it.
  const claimed = await prisma.channelConnection.findUnique({
    where: { type_phoneNumberId: { type: "WHATSAPP", phoneNumberId } },
  });
  if (claimed && claimed.organisationId !== ctx.organisation.id) {
    throw new Error("This phone number is already connected to another workspace");
  }

  const data = {
    wabaId,
    phoneNumberId,
    displayPhoneNumber,
    accessTokenEncrypted: encryptSecret(accessToken),
    status: "ACTIVE" as const,
  };
  const connection = claimed
    ? await prisma.channelConnection.update({ where: { id: claimed.id }, data })
    : await prisma.channelConnection.upsert({
        where: {
          organisationId_type_displayName: {
            organisationId: ctx.organisation.id,
            type: "WHATSAPP",
            displayName: `WhatsApp ${displayPhoneNumber}`,
          },
        },
        update: data,
        create: {
          organisationId: ctx.organisation.id,
          type: "WHATSAPP",
          displayName: `WhatsApp ${displayPhoneNumber}`,
          ...data,
        },
      });

  // Prove token + number ownership against the provider; stamp the result.
  const adapter = getChannelAdapter("WHATSAPP");
  const status = adapter
    ? await adapter.verifyConnection(connection)
    : { healthy: false, detail: "adapter unavailable" };
  await prisma.channelConnection.update({
    where: { id: connection.id },
    data: status.healthy
      ? { lastVerifiedAt: new Date(), lastError: null }
      : { lastErrorAt: new Date(), lastError: status.detail },
  });

  await audit(ctx, {
    eventType: "channel.connected",
    targetType: "ChannelConnection",
    targetId: connection.id,
    // Identifiers only — never the token, never customer content.
    after: { channelType: "WHATSAPP", wabaId, phoneNumberId, verified: status.healthy },
  });
  return { connectionId: connection.id, verified: status.healthy, detail: status.detail };
}

export async function setWhatsAppStageGates(
  ctx: OrgContext,
  connectionId: string,
  gates: { inboundEnabled?: boolean; outboundEnabled?: boolean },
): Promise<void> {
  requirePermission(ctx.membership.role, "channels:manage");
  const connection = await prisma.channelConnection.findFirst({
    where: { ...scope(ctx), id: connectionId, type: "WHATSAPP" },
  });
  if (!connection) throw new Error("Connection not found");
  await prisma.channelConnection.update({
    where: { id: connection.id },
    data: {
      ...(gates.inboundEnabled === undefined ? {} : { inboundEnabled: gates.inboundEnabled }),
      ...(gates.outboundEnabled === undefined
        ? {}
        : { outboundEnabled: gates.outboundEnabled }),
    },
  });
  await audit(ctx, {
    eventType: "channel.stage_gates_updated",
    targetType: "ChannelConnection",
    targetId: connection.id,
    before: {
      inboundEnabled: connection.inboundEnabled,
      outboundEnabled: connection.outboundEnabled,
    },
    after: {
      inboundEnabled: gates.inboundEnabled ?? connection.inboundEnabled,
      outboundEnabled: gates.outboundEnabled ?? connection.outboundEnabled,
    },
  });
}

export async function verifyWhatsAppConnection(
  ctx: OrgContext,
  connectionId: string,
): Promise<{ healthy: boolean; detail: string | null }> {
  requirePermission(ctx.membership.role, "channels:manage");
  const connection = await prisma.channelConnection.findFirst({
    where: { ...scope(ctx), id: connectionId, type: "WHATSAPP" },
  });
  if (!connection) throw new Error("Connection not found");
  const adapter = getChannelAdapter("WHATSAPP");
  const status = adapter
    ? await adapter.verifyConnection(connection)
    : { healthy: false, detail: "adapter unavailable" };
  await prisma.channelConnection.update({
    where: { id: connection.id },
    data: status.healthy
      ? { lastVerifiedAt: new Date(), lastError: null }
      : { lastErrorAt: new Date(), lastError: status.detail },
  });
  return status;
}
