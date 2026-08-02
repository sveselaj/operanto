import type { MessageDeliveryStatus } from "@prisma/client";

/**
 * Delivery-status state machine — pure and monotonic. A status may only move
 * FORWARD along the delivery lifecycle; late or duplicated provider webhooks
 * can never regress a message (a READ message never becomes merely SENT).
 *
 *   RECORDED → QUEUED → SENT → DELIVERED → READ
 *
 * FAILED is reachable from any pre-terminal state; nothing leaves FAILED or
 * READ. RECORDED rows never transition at all in Slice 5A — they are local
 * by definition and no worker may touch them (see the schema invariant).
 */

const ORDER: Record<MessageDeliveryStatus, number> = {
  RECORDED: 0,
  QUEUED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

const TERMINAL: ReadonlySet<MessageDeliveryStatus> = new Set(["READ", "FAILED"]);

export function shouldAdvance(
  from: MessageDeliveryStatus,
  to: MessageDeliveryStatus,
): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  // RECORDED is the local/unsent state — Slice 5A defines no transition out
  // of it; the explicit send operation of Slice 5B is the only thing that
  // may ever move a message to QUEUED.
  if (from === "RECORDED") return false;
  if (to === "FAILED") return true;
  return ORDER[to] > ORDER[from];
}
