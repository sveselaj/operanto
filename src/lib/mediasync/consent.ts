import "server-only";
import type { ChannelType, Consent, ConsentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectConsentSignal } from "./consent-keywords";

/**
 * MediaSync — consent / opt-in–opt-out state.
 *
 * Every outbound send goes through `canSend` first. Opt-out is honored both
 * when a customer texts a stop keyword (handled during ingestion) and when an
 * agent sets it manually. Functions are workspace-scoped by id so the webhook
 * ingestion path (no logged-in user) can call them too.
 */

export type SendGate = {
  ok: boolean;
  status: ConsentStatus;
  reason?: string;
};

export function getConsent(
  workspaceId: string,
  customerId: string,
  channelType: ChannelType,
): Promise<Consent | null> {
  return prisma.consent.findFirst({ where: { workspaceId, customerId, channelType } });
}

export function listConsentForCustomer(
  workspaceId: string,
  customerId: string,
): Promise<Consent[]> {
  return prisma.consent.findMany({
    where: { workspaceId, customerId },
    orderBy: { channelType: "asc" },
  });
}

/** Gate an outbound send. Only an explicit opt-out blocks; unknown is allowed. */
export async function canSend(
  workspaceId: string,
  customerId: string,
  channelType: ChannelType,
): Promise<SendGate> {
  const consent = await getConsent(workspaceId, customerId, channelType);
  const status = consent?.status ?? "unknown";
  if (status === "opted_out") {
    return {
      ok: false,
      status,
      reason: `Customer has opted out of ${channelType} messages.`,
    };
  }
  return { ok: true, status };
}

export async function setConsent(
  workspaceId: string,
  customerId: string,
  channelType: ChannelType,
  status: ConsentStatus,
  meta: { source?: string; reason?: string; updatedByUserId?: string | null } = {},
): Promise<Consent> {
  const existing = await prisma.consent.findFirst({
    where: { workspaceId, customerId, channelType },
    select: { id: true },
  });
  if (existing) {
    return prisma.consent.update({
      where: { id: existing.id },
      data: {
        status,
        source: meta.source,
        reason: meta.reason,
        updatedByUserId: meta.updatedByUserId ?? null,
      },
    });
  }
  return prisma.consent.create({
    data: {
      workspaceId,
      customerId,
      channelType,
      status,
      source: meta.source,
      reason: meta.reason,
      updatedByUserId: meta.updatedByUserId ?? null,
    },
  });
}

/**
 * Inspect an inbound message for a STOP/START keyword and update consent
 * accordingly. Returns the applied status, or null if the message wasn't a
 * consent command.
 */
export async function applyInboundConsentSignal(
  workspaceId: string,
  customerId: string,
  channelType: ChannelType,
  body: string,
): Promise<ConsentStatus | null> {
  const signal = detectConsentSignal(body);
  if (!signal) return null;
  const status: ConsentStatus = signal === "opt_out" ? "opted_out" : "opted_in";
  await setConsent(workspaceId, customerId, channelType, status, { source: "keyword_stop" });
  return status;
}
