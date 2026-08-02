import { NextResponse, after } from "next/server";
import { getChannelAdapter } from "@/lib/channels/registry";
import {
  processChannelInboundEvent,
  storeChannelPayload,
} from "@/lib/services/channel-ingest";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";

/**
 * WhatsApp Cloud webhook — the one public entry point for Meta traffic.
 *
 * Order of checks is deliberate: deployment flag → rate limit → size →
 * SIGNATURE against the raw body with the Operanto-managed app secret
 * (before JSON parsing and before ANY tenant data processing) → parse →
 * store through the canonical ChannelInboundEvent pipeline → 200 → process
 * after the response (the retry sweep is the safety net).
 *
 * Routing is authoritative: the pipeline resolves the tenant ONLY by the
 * receiving number's phone_number_id against an ACTIVE, inbound-enabled
 * connection. Unknown or ambiguous routing is acknowledged with 200 (a
 * non-2xx would only make Meta hammer retries) and recorded content-minimised
 * — the routing ref, never payload content.
 */

const MAX_BODY_BYTES = 512 * 1024;

function inboundEnabled(): boolean {
  return process.env.OPERANTO_WHATSAPP_INBOUND_ENABLED === "1";
}

/** Meta subscription handshake (webhook verification). */
export async function GET(req: Request) {
  if (!inboundEnabled()) return new NextResponse(null, { status: 404 });
  const adapter = getChannelAdapter("WHATSAPP");
  const challenge = adapter?.verifyChallenge(new URL(req.url));
  if (!challenge) return new NextResponse(null, { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(req: Request) {
  if (!inboundEnabled()) return new NextResponse(null, { status: 404 });
  const adapter = getChannelAdapter("WHATSAPP");
  if (!adapter) return new NextResponse(null, { status: 404 });

  const ip = clientIp(req.headers);
  const limit = await rateLimit(`wa:ip:${identifierKey(ip)}`, 600, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  // Signature first — nothing tenant-shaped happens before this line.
  if (!adapter.verifySignature(req.headers, rawBody, null)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const stored = await storeChannelPayload("WHATSAPP", payload);
  if ("rejected" in stored) {
    // Content-minimised operational record: the routing ref only.
    console.warn(
      `[whatsapp] rejected webhook (${stored.rejected}) ref=${adapter.connectionRef(payload) ?? "none"}`,
    );
    return NextResponse.json({ ok: true, ignored: stored.rejected }, { status: 200 });
  }
  if (stored.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  after(() =>
    processChannelInboundEvent(stored.eventId).catch((error) => {
      // The retry sweep picks the event up; this log is for operators.
      console.error(`[whatsapp] processing ${stored.eventId} failed:`, error);
    }),
  );
  return NextResponse.json({ ok: true }, { status: 200 });
}
