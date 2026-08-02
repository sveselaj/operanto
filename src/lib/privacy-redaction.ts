import type { Prisma } from "@prisma/client";

/**
 * Pure redaction rules for stored event payloads.
 *
 * Deliberately free of `server-only` and of any database or auth import, so it
 * can be unit-tested directly — this is the function that decides whether a
 * customer's name, phone and message survive in the event archive, and it
 * should be the easiest thing in the codebase to verify.
 */

/**
 * Replace a raw event payload with a skeleton that keeps only what operations
 * need — event type, timing and correlation — and no personal data.
 *
 * The envelope is ALLOW-listed rather than the payload being pruned: a future
 * producer field carrying personal data is then redacted by default instead of
 * leaking until somebody notices it.
 */
export function redactPayload(
  payload: Prisma.JsonValue,
  options: { unlink?: boolean } = {},
): Prisma.InputJsonObject {
  const envelope = (payload ?? {}) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    eventId: str(envelope.eventId),
    eventType: str(envelope.eventType),
    schemaVersion:
      typeof envelope.schemaVersion === "number" ? envelope.schemaVersion : null,
    occurredAt: str(envelope.occurredAt),
    source: str(envelope.source),
    organisationId: str(envelope.organisationId),
    // correlationId is the SOURCE record id (a Pronatona lead). For routine
    // retention it stays: it is not personal data by itself and it is what
    // makes an old event traceable. For an erasure request it must go, because
    // it is exactly the key that links this row back to the person in the
    // source system.
    correlationId: options.unlink ? null : str(envelope.correlationId),
    redacted: true,
  } satisfies Prisma.InputJsonObject;
}

/** Days a raw payload is kept before the retention sweep redacts it. */
export function payloadRetentionDays(): number {
  const raw = Number(process.env.OPERANTO_PAYLOAD_RETENTION_DAYS ?? 30);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/**
 * Days a conversation message body is kept before the retention sweep redacts
 * it. Per-organisation override first, then the environment, then 365 days —
 * the PROVISIONAL 12-month default from the consolidation decisions. The
 * production value still requires contractual and legal confirmation; this
 * function is where that confirmed value will land.
 */
export function messageRetentionDays(organisationOverride?: number | null): number {
  if (
    typeof organisationOverride === "number" &&
    Number.isFinite(organisationOverride) &&
    organisationOverride > 0
  ) {
    return organisationOverride;
  }
  const raw = Number(process.env.OPERANTO_MESSAGE_RETENTION_DAYS ?? 365);
  return Number.isFinite(raw) && raw > 0 ? raw : 365;
}
