import type { MessageDeliveryStatus } from "@prisma/client";

/**
 * Delivery-status state machine — pure and monotonic. A status may only move
 * FORWARD along the delivery lifecycle; late or duplicated provider webhooks
 * can never regress a message (a READ message never becomes merely SENT).
 *
 *   RECORDED → QUEUED → SENDING → SENT → DELIVERED → READ
 *
 * FAILED is reachable from any pre-terminal state; nothing leaves FAILED or
 * READ through this machine (the explicit, human-invoked retry operation is
 * the ONE sanctioned FAILED exit and bypasses it deliberately — provider
 * callbacks cannot). RECORDED rows never transition at all — they are local
 * by definition; the explicit send operation creates NEW rows and never
 * moves a RECORDED one.
 */

const ORDER: Record<MessageDeliveryStatus, number> = {
  RECORDED: 0,
  QUEUED: 1,
  SENDING: 2,
  SENT: 3,
  DELIVERED: 4,
  READ: 5,
  FAILED: 6,
};

const TERMINAL: ReadonlySet<MessageDeliveryStatus> = new Set(["READ", "FAILED"]);

export function shouldAdvance(
  from: MessageDeliveryStatus,
  to: MessageDeliveryStatus,
): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  // RECORDED is the local/unsent state — nothing transitions out of it,
  // ever. The Slice 5B send operation creates a NEW outbound message starting
  // at QUEUED; it does not move RECORDED rows.
  if (from === "RECORDED") return false;
  if (to === "FAILED") return true;
  return ORDER[to] > ORDER[from];
}
