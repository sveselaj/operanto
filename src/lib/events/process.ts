import "server-only";
import { prisma } from "@/lib/prisma";
import { auditSystem } from "@/lib/audit";
import { handleEvent } from "@/lib/events/handlers";

/**
 * Event processing pipeline.
 *
 * Receipt (route handler) and processing are decoupled: the route stores the
 * raw event and returns 202; processing runs after the response (`after()`)
 * and is re-runnable via the retry sweep. Single execution is guaranteed by an
 * atomic conditional claim (`updateMany` on processingStatus) — the same
 * pattern the legacy tool runtime used for approvals.
 */

export const MAX_ATTEMPTS = 5;
/**
 * After this long, RECEIVED/PROCESSING rows are considered stuck and become
 * claimable by the retry sweep. Configurable so acceptance tests can drive the
 * sweep deterministically (0 = immediately claimable).
 */
const STALE_AFTER_MS =
  Number(process.env.OPERANTO_STALE_EVENT_MINUTES ?? 10) * 60_000;

export type ProcessOutcome =
  | "processed"
  | "ignored"
  | "failed"
  | "dead_letter"
  | "not_claimed";

export async function processInboundEvent(
  eventDbId: string,
  opts: { allowStale?: boolean } = {},
): Promise<ProcessOutcome> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const claim = await prisma.inboundEvent.updateMany({
    where: {
      id: eventDbId,
      OR: [
        { processingStatus: { in: ["RECEIVED", "FAILED"] } },
        ...(opts.allowStale
          ? [
              {
                processingStatus: "PROCESSING" as const,
                receivedAt: { lt: staleBefore },
              },
            ]
          : []),
      ],
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    data: { processingStatus: "PROCESSING", attemptCount: { increment: 1 } },
  });
  if (claim.count === 0) return "not_claimed";

  const event = await prisma.inboundEvent.findUniqueOrThrow({
    where: { id: eventDbId },
  });

  try {
    const result = await handleEvent(event);
    await prisma.$transaction([
      prisma.inboundEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: "PROCESSED",
          processedAt: new Date(),
          lastError: null,
        },
      }),
      prisma.integration.update({
        where: { id: event.integrationId },
        data: { lastSuccessfulAt: new Date() },
      }),
    ]);
    await auditSystem(event.organisationId, "INTEGRATION", {
      eventType: result.outcome === "ignored" ? "event.ignored" : "event.processed",
      targetType: "InboundEvent",
      targetId: event.id,
      correlationId: event.correlationId ?? event.eventId,
      after: { eventType: event.eventType, summary: result.summary },
    });
    return result.outcome === "ignored" ? "ignored" : "processed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `attemptCount` was already incremented by the claim above, and the claim
    // gate is `attemptCount < MAX_ATTEMPTS`. So the event is out of attempts
    // exactly when the counter has reached MAX_ATTEMPTS — comparing against
    // attemptCount + 1 here would park it with one claimable attempt unused.
    const isFinal = event.attemptCount >= MAX_ATTEMPTS;
    await prisma.$transaction([
      prisma.inboundEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: isFinal ? "DEAD_LETTER" : "FAILED",
          lastError: message.slice(0, 2000),
        },
      }),
      prisma.integration.update({
        where: { id: event.integrationId },
        data: { lastErrorAt: new Date(), lastError: message.slice(0, 2000) },
      }),
    ]);
    await auditSystem(event.organisationId, "INTEGRATION", {
      eventType: isFinal ? "event.dead_lettered" : "event.failed",
      targetType: "InboundEvent",
      targetId: event.id,
      correlationId: event.correlationId ?? event.eventId,
      after: { eventType: event.eventType, error: message.slice(0, 500) },
    });
    return isFinal ? "dead_letter" : "failed";
  }
}

/**
 * Retry sweep: re-processes FAILED events (with attempts remaining) and
 * events stuck in RECEIVED/PROCESSING (e.g. the after() hook never ran).
 * Called from the CRON-protected internal route and the admin retry action.
 */
export async function retryPendingEvents(limit = 25): Promise<{
  scanned: number;
  processed: number;
  failed: number;
}> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const candidates = await prisma.inboundEvent.findMany({
    where: {
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [
        { processingStatus: "FAILED" },
        {
          processingStatus: { in: ["RECEIVED", "PROCESSING"] },
          receivedAt: { lt: staleBefore },
        },
      ],
    },
    orderBy: { occurredAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const outcome = await processInboundEvent(candidate.id, { allowStale: true });
    if (outcome === "processed" || outcome === "ignored") processed += 1;
    else if (outcome === "failed" || outcome === "dead_letter") failed += 1;
  }
  return { scanned: candidates.length, processed, failed };
}
