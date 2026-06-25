import "server-only";
import type { MessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DeliveryStatus } from "@/lib/channels";

/**
 * MediaSync — outbound delivery status.
 *
 * Status webhooks from providers (and the in-app demo path) flow through here.
 * Status only moves forward (queued → sent → delivered → read); a `failed`
 * always applies. This keeps an out-of-order "delivered" from clobbering a
 * later "read".
 */

const RANK: Record<MessageStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 1, // terminal, but comparable to "sent" for ordering
};

/** Whether a transition from `from` to `to` should be persisted. */
export function shouldAdvance(from: MessageStatus, to: MessageStatus): boolean {
  if (to === "failed") return from !== "failed";
  return RANK[to] > RANK[from];
}

/**
 * Apply a delivery-status update keyed by the provider's external message id.
 * Returns true if a message row was updated.
 */
export async function applyStatusUpdate(
  workspaceId: string,
  externalMessageId: string,
  status: DeliveryStatus,
  error?: string | null,
): Promise<boolean> {
  const message = await prisma.message.findFirst({
    where: { workspaceId, externalMessageId },
    select: { id: true, status: true },
  });
  if (!message) return false;
  if (!shouldAdvance(message.status, status)) return false;

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status,
      statusUpdatedAt: new Date(),
      errorMessage: status === "failed" ? (error ?? "Delivery failed") : null,
    },
  });
  return true;
}

/** Set a known message's status directly (used right after an outbound send). */
export async function setMessageStatus(
  messageId: string,
  status: MessageStatus,
  error?: string | null,
): Promise<void> {
  await prisma.message.update({
    where: { id: messageId },
    data: {
      status,
      statusUpdatedAt: new Date(),
      errorMessage: status === "failed" ? (error ?? "Delivery failed") : null,
    },
  });
}
