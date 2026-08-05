import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { telephonyProvider } from "@/lib/telephony-providers";

/**
 * Telephony connection administration (provider-neutral; OI voice slice 1).
 *
 * Deliberately NOT behind an environment flag: this is configuration
 * storage an admin manages entirely in the app (the user requirement).
 * Nothing operational happens from a stored connection - dialing and
 * webhook ingestion arrive with the adapter slice and carry their own
 * runtime gates (per-connection inbound/outbound stage gates below).
 *
 * Mirrors the WhatsApp connection discipline: credentials encrypted before
 * they touch the database, never returned from any function here, never in
 * audit metadata. Stage gates default OFF; a stored connection does nothing
 * until the provider adapter (calling/webhook slice) consumes it.
 * The provider catalog (src/lib/telephony-providers.ts) is the single source
 * of truth for which credential fields each provider requires.
 */

const publicSelect = {
  id: true,
  provider: true,
  displayName: true,
  accountRef: true,
  status: true,
  inboundEnabled: true,
  outboundEnabled: true,
  lastVerifiedAt: true,
  lastEventAt: true,
  lastError: true,
  createdAt: true,
} as const;

export async function listTelephonyConnections(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "channels:manage");
  return prisma.telephonyConnection.findMany({
    where: scope(ctx),
    select: publicSelect,
    orderBy: { createdAt: "asc" },
  });
}

export interface ConnectTelephonyInput {
  provider: string;
  displayName: string;
  apiKey?: string;
  apiSecret?: string;
  accountRef?: string;
}

export interface ConnectTelephonyResult {
  connectionId: string;
  /**
   * Shown exactly once: the signing secret for the provider's webhook
   * configuration. Stored encrypted; there is no read-back path.
   */
  webhookSecret: string;
}

export async function connectTelephony(
  ctx: OrgContext,
  input: ConnectTelephonyInput,
): Promise<ConnectTelephonyResult> {
  requirePermission(ctx.membership.role, "channels:connect");

  const spec = telephonyProvider(input.provider);
  if (!spec) throw new Error("Unknown telephony provider");
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 100) {
    throw new Error("Display name must be 1–100 characters");
  }

  // Validate exactly the fields the catalog declares for this provider.
  const values: Record<"apiKey" | "apiSecret" | "accountRef", string | undefined> = {
    apiKey: input.apiKey?.trim() || undefined,
    apiSecret: input.apiSecret?.trim() || undefined,
    accountRef: input.accountRef?.trim() || undefined,
  };
  for (const field of spec.fields) {
    const optional = field.label.toLowerCase().includes("optional");
    if (!optional && !values[field.key]) {
      throw new Error(`${field.label} is required for ${spec.label}`);
    }
  }

  const webhookSecret = randomBytes(32).toString("hex");
  const connection = await prisma.telephonyConnection.upsert({
    where: {
      organisationId_provider_displayName: {
        organisationId: ctx.organisation.id,
        provider: spec.id,
        displayName,
      },
    },
    update: {
      accountRef: values.accountRef ?? null,
      apiKeyEncrypted: values.apiKey ? encryptSecret(values.apiKey) : null,
      apiSecretEncrypted: values.apiSecret ? encryptSecret(values.apiSecret) : null,
      webhookSecretEncrypted: encryptSecret(webhookSecret),
      status: "ACTIVE",
      lastError: null,
    },
    create: {
      organisationId: ctx.organisation.id,
      provider: spec.id,
      displayName,
      accountRef: values.accountRef ?? null,
      apiKeyEncrypted: values.apiKey ? encryptSecret(values.apiKey) : null,
      apiSecretEncrypted: values.apiSecret ? encryptSecret(values.apiSecret) : null,
      webhookSecretEncrypted: encryptSecret(webhookSecret),
    },
    select: { id: true },
  });

  await audit(ctx, {
    eventType: "telephony.connection_saved",
    targetType: "TelephonyConnection",
    targetId: connection.id,
    after: { provider: spec.id },
  });
  return { connectionId: connection.id, webhookSecret };
}

export async function setTelephonyStageGates(
  ctx: OrgContext,
  connectionId: string,
  gates: { inboundEnabled?: boolean; outboundEnabled?: boolean },
): Promise<void> {
  requirePermission(ctx.membership.role, "channels:manage");
  const existing = await prisma.telephonyConnection.findFirst({
    where: { ...scope(ctx), id: connectionId },
    select: { id: true, inboundEnabled: true, outboundEnabled: true },
  });
  if (!existing) throw new Error("Telephony connection not found");

  await prisma.telephonyConnection.update({
    where: { id: existing.id },
    data: {
      ...(gates.inboundEnabled === undefined ? {} : { inboundEnabled: gates.inboundEnabled }),
      ...(gates.outboundEnabled === undefined ? {} : { outboundEnabled: gates.outboundEnabled }),
    },
  });
  await audit(ctx, {
    eventType: "telephony.stage_gates_updated",
    targetType: "TelephonyConnection",
    targetId: existing.id,
    before: { inboundEnabled: existing.inboundEnabled, outboundEnabled: existing.outboundEnabled },
    after: {
      inboundEnabled: gates.inboundEnabled ?? existing.inboundEnabled,
      outboundEnabled: gates.outboundEnabled ?? existing.outboundEnabled,
    },
  });
}

export async function disableTelephonyConnection(
  ctx: OrgContext,
  connectionId: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "channels:manage");
  const existing = await prisma.telephonyConnection.findFirst({
    where: { ...scope(ctx), id: connectionId },
    select: { id: true },
  });
  if (!existing) throw new Error("Telephony connection not found");
  await prisma.telephonyConnection.update({
    where: { id: existing.id },
    data: { status: "DISABLED", inboundEnabled: false, outboundEnabled: false },
  });
  await audit(ctx, {
    eventType: "telephony.connection_disabled",
    targetType: "TelephonyConnection",
    targetId: existing.id,
  });
}
