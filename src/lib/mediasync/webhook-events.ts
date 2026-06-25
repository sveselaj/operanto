import "server-only";
import type { ChannelType, Prisma, WebhookStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * MediaSync — raw webhook intake.
 *
 * Every inbound webhook is persisted before processing so events can be
 * deduplicated (idempotency via `dedupeKey`), replayed, and audited. This is
 * what lets the diagnostics page show "last webhook received" per channel and
 * what protects ingestion from double-processing provider retries.
 */

export type RecordWebhookInput = {
  channelType: ChannelType;
  channelAccountId?: string | null;
  workspaceId?: string | null;
  eventType?: string;
  dedupeKey?: string | null;
  signatureValid: boolean;
  headers?: Record<string, string> | null;
  payload: unknown;
};

export type RecordWebhookResult = { id: string; duplicate: boolean };

/**
 * Persist a webhook event. When a non-null `dedupeKey` was already seen for the
 * channel, returns the existing row with `duplicate: true` and does not insert.
 */
export async function recordWebhookEvent(
  input: RecordWebhookInput,
): Promise<RecordWebhookResult> {
  if (input.dedupeKey) {
    const existing = await prisma.webhookEvent.findUnique({
      where: { channelType_dedupeKey: { channelType: input.channelType, dedupeKey: input.dedupeKey } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, duplicate: true };
  }

  const event = await prisma.webhookEvent.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      channelType: input.channelType,
      channelAccountId: input.channelAccountId ?? null,
      eventType: input.eventType ?? "message",
      dedupeKey: input.dedupeKey ?? null,
      signatureValid: input.signatureValid,
      status: "received",
      headers: (input.headers ?? undefined) as Prisma.InputJsonValue | undefined,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: event.id, duplicate: false };
}

/** Mark an event processed/failed/ignored and stamp the resolved workspace. */
export async function markWebhookEvent(
  id: string,
  status: WebhookStatus,
  opts: { workspaceId?: string | null; error?: string | null } = {},
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      status,
      error: opts.error ?? null,
      processedAt: new Date(),
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    },
  });
}
