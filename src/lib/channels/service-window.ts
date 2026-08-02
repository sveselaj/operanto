/**
 * WhatsApp 24-hour customer-service window — pure calculation, recalculated
 * server-side at every send attempt. The window opens at the LAST inbound
 * customer message; UI state is never trusted for this decision.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ServiceWindowState = {
  withinWindow: boolean;
  /** When the current window closes; null when no inbound message exists. */
  expiresAt: Date | null;
};

export function serviceWindowState(
  lastInboundAt: Date | null,
  now: Date,
): ServiceWindowState {
  if (!lastInboundAt) return { withinWindow: false, expiresAt: null };
  const expiresAt = new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS);
  return { withinWindow: now < expiresAt, expiresAt };
}
