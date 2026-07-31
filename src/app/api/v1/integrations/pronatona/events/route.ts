import { NextResponse, after } from "next/server";
import type { Integration, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, safeEqual, signEventPayload } from "@/lib/crypto";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";
import {
  MAX_EVENT_BODY_BYTES,
  REPLAY_WINDOW_SECONDS,
  eventEnvelopeSchema,
} from "@/lib/events/envelope";
import { processInboundEvent } from "@/lib/events/process";

/**
 * Signed event ingestion from Pronatona.
 *
 * Order of checks is deliberate: rate limit → size → headers → signature
 * (timing-safe, against the raw body, BEFORE parsing JSON) → replay window →
 * envelope validation → idempotent store. Processing happens after the
 * response; failures are retried by the internal sweep.
 *
 * Responses: 202 accepted · 200 duplicate · 401 signature/auth ·
 * 400 malformed · 403 disabled integration · 413 too large · 429 rate limited.
 */

const err = (status: number, code: string) =>
  NextResponse.json({ ok: false, error: code }, { status });

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const limit = await rateLimit(`ingest:ip:${identifierKey(ip)}`, 240, 60_000);
  if (!limit.allowed) return err(429, "rate_limited");

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_EVENT_BODY_BYTES) return err(413, "payload_too_large");

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_EVENT_BODY_BYTES) {
    return err(413, "payload_too_large");
  }

  const headerEventId = req.headers.get("x-operanto-event-id");
  const timestamp = req.headers.get("x-operanto-timestamp");
  const signature = req.headers.get("x-operanto-signature");
  if (!headerEventId || !timestamp || !signature) return err(401, "missing_headers");

  // Replay window (checked before signature work to bound cost; the timestamp
  // itself is authenticated because it is part of the signed message).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return err(401, "invalid_timestamp");
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > REPLAY_WINDOW_SECONDS) return err(401, "timestamp_outside_window");

  // Identify the sending integration by verifying against each registered
  // Pronatona integration's secret (constant, small set — one per tenant).
  const integrations = await prisma.integration.findMany({
    where: { type: "PRONATONA" },
  });
  let matched: Integration | null = null;
  for (const integration of integrations) {
    let secret: string;
    try {
      secret = decryptSecret(integration.webhookSecretEncrypted);
    } catch {
      continue; // undecryptable secret — treat as non-matching, never 500
    }
    const expected = signEventPayload(secret, timestamp, rawBody);
    if (safeEqual(expected, signature)) {
      matched = integration;
      break;
    }
  }
  if (!matched) return err(401, "invalid_signature");

  await prisma.integration.update({
    where: { id: matched.id },
    data: { lastReceivedAt: new Date() },
  });

  if (matched.status !== "ACTIVE") return err(403, "integration_disabled");

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return err(400, "invalid_json");
  }
  const envelope = eventEnvelopeSchema.safeParse(parsedBody);
  if (!envelope.success) return err(400, "invalid_envelope");
  if (envelope.data.eventId !== headerEventId) return err(400, "event_id_mismatch");
  if (envelope.data.organisationId !== matched.sourceOrganisationId) {
    // Signed with the right secret but claiming a different source org — an
    // unrecoverable mapping conflict.
    return err(409, "source_organisation_mismatch");
  }

  try {
    const stored = await prisma.inboundEvent.create({
      data: {
        organisationId: matched.organisationId,
        integrationId: matched.id,
        eventId: envelope.data.eventId,
        eventType: envelope.data.eventType,
        schemaVersion: envelope.data.schemaVersion,
        sourceSystem: envelope.data.source,
        sourceOrganisationId: envelope.data.organisationId,
        occurredAt: new Date(envelope.data.occurredAt),
        correlationId: envelope.data.correlationId ?? null,
        rawPayload: envelope.data as unknown as Prisma.InputJsonObject,
      },
    });
    after(() =>
      processInboundEvent(stored.id).catch((error) => {
        // The retry sweep will pick the event up; this log is for operators.
        console.error(`[events] processing ${stored.eventId} failed:`, error);
      }),
    );
    return NextResponse.json({ ok: true, received: stored.eventId }, { status: 202 });
  } catch (error) {
    // Unique violation on (integrationId, eventId) → idempotent duplicate.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { ok: true, received: envelope.data.eventId, duplicate: true },
        { status: 200 },
      );
    }
    throw error;
  }
}
