import "server-only";
import { Prisma, type ChannelType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditSystem } from "@/lib/audit";
import { normalizeEmail } from "@/lib/normalize";
import { getChannelAdapter } from "@/lib/channels/registry";
import { shouldAdvance } from "@/lib/channels/delivery";
import { detectConsentSignal } from "@/lib/channels/consent-keywords";
import { resolveCustomerByChannelIdentity } from "@/lib/services/customer-identity";
import type {
  NormalizedDeliveryStatus,
  NormalizedInboundMessage,
} from "@/lib/channels/types";

/**
 * Channel ingestion — store-then-process, mirroring the proven InboundEvent
 * pipeline: persist the raw payload behind a tenant-safe unique constraint,
 * acknowledge, then process under an atomic claim with bounded retries and a
 * dead-letter state. Runs with SYSTEM authority (there is no signed-in user
 * during channel ingestion); every write is explicitly organisation-scoped
 * through the resolved connection, and an unresolvable tenant is a refusal —
 * never a fallback lookup.
 */

const MAX_ATTEMPTS = 5;
const STALE_MINUTES = 10;

export type StoreResult =
  | { stored: true; eventId: string; duplicate: false }
  | { stored: false; eventId: string; duplicate: true }
  | { stored: false; rejected: string };

export async function storeChannelPayload(
  channelType: ChannelType,
  payload: unknown,
): Promise<StoreResult> {
  const adapter = getChannelAdapter(channelType);
  if (!adapter) return { stored: false, rejected: "unknown_channel" };

  const kind = adapter.classifyEvent(payload);
  if (kind === "ignore") return { stored: false, rejected: "unclassified" };
  const ref = adapter.connectionRef(payload);
  if (!ref) return { stored: false, rejected: "unresolvable_tenant" };
  const dedupeKey = adapter.dedupeKey(payload);
  if (!dedupeKey) return { stored: false, rejected: "no_dedupe_key" };

  // Tenant resolution is exact and per-type: the simulator references the
  // connection id; WhatsApp resolves by the AUTHORITATIVE phone_number_id
  // (globally unique by constraint) and additionally requires the inbound
  // stage gate. No first-match scans, no fallback tenant, ever.
  const connection = await prisma.channelConnection.findFirst({
    where:
      channelType === "WHATSAPP"
        ? { type: channelType, phoneNumberId: ref, status: "ACTIVE", inboundEnabled: true }
        : { id: ref, type: channelType, status: "ACTIVE" },
  });
  if (!connection) return { stored: false, rejected: "unresolvable_tenant" };

  try {
    const event = await prisma.channelInboundEvent.create({
      data: {
        organisationId: connection.organisationId,
        channelConnectionId: connection.id,
        eventKind: kind,
        dedupeKey,
        rawPayload: payload as Prisma.InputJsonValue,
      },
    });
    await prisma.channelConnection.update({
      where: { id: connection.id },
      data: { lastReceivedAt: new Date() },
    });
    return { stored: true, eventId: event.id, duplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.channelInboundEvent.findUniqueOrThrow({
        where: {
          channelConnectionId_dedupeKey: {
            channelConnectionId: connection.id,
            dedupeKey,
          },
        },
        select: { id: true },
      });
      return { stored: false, eventId: existing.id, duplicate: true };
    }
    throw error;
  }
}

export type ProcessResult = {
  status: "PROCESSED" | "FAILED" | "DEAD_LETTER" | "SKIPPED" | "IGNORED";
  conversationId: string | null;
  messageId: string | null;
  customerId: string | null;
};

export async function processChannelInboundEvent(
  eventId: string,
): Promise<ProcessResult> {
  // Atomic claim — exactly one processor wins; exhausted rows are left for
  // the dead-letter accounting below.
  const claimed = await prisma.channelInboundEvent.updateMany({
    where: {
      id: eventId,
      status: { in: ["RECEIVED", "FAILED"] },
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    data: { status: "PROCESSING", attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return { status: "SKIPPED", conversationId: null, messageId: null, customerId: null };
  }

  const event = await prisma.channelInboundEvent.findUniqueOrThrow({
    where: { id: eventId },
    include: { connection: true },
  });
  const adapter = getChannelAdapter(event.connection.type);

  try {
    if (!adapter) throw new Error(`No adapter for channel ${event.connection.type}`);
    const normalized = adapter.receiveEvents(event.rawPayload);
    if (normalized.length === 0) {
      await prisma.channelInboundEvent.update({
        where: { id: event.id },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return { status: "IGNORED", conversationId: null, messageId: null, customerId: null };
    }

    let conversationId: string | null = null;
    let messageId: string | null = null;
    let customerId: string | null = null;

    for (const item of normalized) {
      if (item.kind === "message") {
        const result = await projectInboundMessage(event.organisationId, event.connection.id, event.connection.type, item);
        conversationId = result.conversationId;
        messageId = result.messageId ?? messageId;
        customerId = result.customerId;
      } else {
        await applyDeliveryStatus(event.organisationId, event.connection.id, item);
      }
    }

    await prisma.channelInboundEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), conversationId, lastError: null },
    });
    await prisma.channelConnection.update({
      where: { id: event.connection.id },
      data: { lastSuccessfulAt: new Date() },
    });
    await auditSystem(event.organisationId, "SYSTEM", {
      eventType: "channel.event_processed",
      targetType: "ChannelInboundEvent",
      targetId: event.id,
      after: { eventKind: event.eventKind, conversationId, channelType: event.connection.type },
    });
    return { status: "PROCESSED", conversationId, messageId, customerId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown";
    const exhausted = event.attemptCount >= MAX_ATTEMPTS;
    await prisma.channelInboundEvent.update({
      where: { id: event.id },
      data: { status: exhausted ? "DEAD_LETTER" : "FAILED", lastError: message },
    });
    await prisma.channelConnection.update({
      where: { id: event.connection.id },
      data: { lastErrorAt: new Date(), lastError: message },
    });
    await auditSystem(event.organisationId, "SYSTEM", {
      eventType: exhausted ? "channel.event_dead_lettered" : "channel.event_failed",
      targetType: "ChannelInboundEvent",
      targetId: event.id,
      after: { attemptCount: event.attemptCount },
    });
    return {
      status: exhausted ? "DEAD_LETTER" : "FAILED",
      conversationId: null,
      messageId: null,
      customerId: null,
    };
  }
}

async function projectInboundMessage(
  organisationId: string,
  channelConnectionId: string,
  channelType: ChannelType,
  item: NormalizedInboundMessage,
): Promise<{ conversationId: string; messageId: string | null; customerId: string | null }> {
  return prisma.$transaction(async (tx) => {
    // Identity ladder for channels, exact matches only, tombstones never
    // re-matched: taught channel identity → exact e-mail → unlinked.
    const customer =
      (item.sender.externalId
        ? await resolveCustomerByChannelIdentity(
            tx,
            organisationId,
            channelType,
            item.sender.externalId,
          )
        : null) ??
      (item.sender.email
        ? await tx.customer.findFirst({
            where: {
              organisationId,
              erasedAt: null,
              emailNormalized: normalizeEmail(item.sender.email),
            },
          })
        : null);

    const now = new Date();
    const existing = await tx.conversation.findUnique({
      where: {
        organisationId_channelConnectionId_providerThreadId: {
          organisationId,
          channelConnectionId,
          providerThreadId: item.providerThreadId,
        },
      },
    });
    const conversation =
      existing ??
      (await tx.conversation.create({
        data: {
          organisationId,
          customerId: customer?.id ?? null,
          channelConnectionId,
          channelType,
          providerThreadId: item.providerThreadId,
          subject: item.subject,
          lastMessageAt: now,
          lastInboundAt: now,
        },
      }));
    if (!existing) {
      await tx.conversationParticipant.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          type: "CUSTOMER",
          customerId: customer?.id ?? null,
          displayName: customer ? null : item.sender.displayName,
          externalRef: item.sender.externalId,
        },
      });
      await tx.activity.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          customerId: customer?.id ?? null,
          actorType: "SYSTEM",
          activityType: "conversation.created",
          sourceSystem: channelType,
          summary: "Conversation opened by inbound channel message",
        },
      });
    }

    let messageId: string | null = null;
    try {
      const message = await tx.message.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          channelConnectionId,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          body: item.body,
          providerMessageId: item.providerMessageId,
          providerTimestamp: item.providerTimestamp,
          // Safe media metadata only; the media_pending state renders in the
          // conversation until binary retrieval ships.
          metadata: item.media ? { media: item.media } : undefined,
        },
      });
      messageId = message.id;
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastInboundAt: now },
      });
      await tx.activity.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          actorType: "CUSTOMER",
          activityType: "conversation.inbound_message",
          sourceSystem: channelType,
          summary: "Inbound message received",
        },
      });

      // Consent keywords apply only to real customers on record.
      const signal = detectConsentSignal(item.body);
      const consentCustomerId = conversation.customerId ?? customer?.id ?? null;
      if (signal && consentCustomerId) {
        const status = signal === "opt_out" ? "OPTED_OUT" : "OPTED_IN";
        await tx.consent.upsert({
          where: {
            organisationId_customerId_channelType: {
              organisationId,
              customerId: consentCustomerId,
              channelType,
            },
          },
          update: { status, source: "inbound_keyword" },
          create: {
            organisationId,
            customerId: consentCustomerId,
            channelType,
            status,
            source: "inbound_keyword",
          },
        });
        await tx.activity.create({
          data: {
            organisationId,
            conversationId: conversation.id,
            customerId: consentCustomerId,
            actorType: "CUSTOMER",
            activityType: "consent.updated",
            sourceSystem: channelType,
            summary:
              signal === "opt_out"
                ? "Customer opted out of this channel"
                : "Customer opted in to this channel",
          },
        });
      }
    } catch (error) {
      // Constraint-based dedupe: a replayed provider message id is a no-op.
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
      ) {
        throw error;
      }
    }

    return {
      conversationId: conversation.id,
      messageId,
      customerId: conversation.customerId ?? customer?.id ?? null,
    };
  });
}

async function applyDeliveryStatus(
  organisationId: string,
  channelConnectionId: string,
  item: NormalizedDeliveryStatus,
): Promise<void> {
  const message = await prisma.message.findUnique({
    where: {
      organisationId_channelConnectionId_providerMessageId: {
        organisationId,
        channelConnectionId,
        providerMessageId: item.providerMessageId,
      },
    },
  });
  if (!message) return; // Unknown message id — nothing to advance.
  if (!shouldAdvance(message.deliveryStatus, item.deliveryStatus)) return;
  // Monotonic conditional update — a racing regression cannot land.
  await prisma.message.updateMany({
    where: { id: message.id, deliveryStatus: message.deliveryStatus },
    data: {
      deliveryStatus: item.deliveryStatus,
      statusUpdatedAt: new Date(),
      errorMessage: item.errorMessage,
    },
  });
}

/** Retry sweep: FAILED plus rows stuck in RECEIVED/PROCESSING too long. */
export async function retryPendingChannelEvents(limit = 25): Promise<{
  scanned: number;
  processed: number;
  deadLettered: number;
}> {
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000);
  const candidates = await prisma.channelInboundEvent.findMany({
    where: {
      OR: [
        { status: "FAILED" },
        { status: { in: ["RECEIVED", "PROCESSING"] }, receivedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  let deadLettered = 0;
  for (const candidate of candidates) {
    // Stuck PROCESSING rows are reclaimed by resetting to FAILED first.
    await prisma.channelInboundEvent.updateMany({
      where: { id: candidate.id, status: "PROCESSING", receivedAt: { lt: staleBefore } },
      data: { status: "FAILED" },
    });
    const result = await processChannelInboundEvent(candidate.id);
    if (result.status === "PROCESSED") processed += 1;
    if (result.status === "DEAD_LETTER") deadLettered += 1;
  }
  return { scanned: candidates.length, processed, deadLettered };
}
