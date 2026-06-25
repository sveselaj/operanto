import { NextResponse } from "next/server";
import { getConnector, isChannelType, ConnectorError } from "@/lib/channels";
import { ingestInbound } from "@/lib/services/ingestion";
import { prisma } from "@/lib/prisma";
import { recordWebhookEvent, markWebhookEvent } from "@/lib/mediasync/webhook-events";
import { applyStatusUpdate } from "@/lib/mediasync/delivery";
import { rateLimit } from "@/lib/mediasync/rate-limit";

/**
 * Public webhook endpoint (MediaSync intake): /api/webhooks/{channel}
 *
 * GET  → provider verification handshake (Meta hub.challenge).
 * POST → rate-limit → verify signature → persist raw event → resolve the
 *        receiving ChannelAccount from the provider account id → classify
 *        message vs delivery-status → process (batched) → mark the event.
 */

const WEBHOOK_LIMIT = { limit: 120, windowMs: 60_000 }; // per channel + client IP

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function pickHeaders(headers: Headers): Record<string, string> {
  const keep = [
    "content-type",
    "user-agent",
    "x-hub-signature-256",
    "x-telegram-bot-api-secret-token",
    "x-webhook-secret",
    "x-forwarded-for",
  ];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = headers.get(k);
    if (v) out[k] = k.includes("secret") || k.includes("signature") ? "[present]" : v;
  }
  return out;
}

type ResolvedAccount = { id: string; workspaceId: string };

/** Resolve the Operanto ChannelAccount from a provider account ref. */
async function resolveAccount(
  channel: string,
  ref: string | null,
): Promise<ResolvedAccount | null> {
  if (ref) {
    const byId = await prisma.channelAccount.findUnique({
      where: { id: ref },
      select: { id: true, workspaceId: true, type: true },
    });
    if (byId && byId.type === channel) return { id: byId.id, workspaceId: byId.workspaceId };
    const byExt = await prisma.channelAccount.findFirst({
      where: { type: channel as never, externalAccountId: ref },
      select: { id: true, workspaceId: true },
    });
    return byExt ?? null; // ref given but unmatched → unknown account
  }
  // No ref (e.g. single-bot Telegram): match the sole account for this channel.
  const sole = await prisma.channelAccount.findFirst({
    where: { type: channel as never },
    select: { id: true, workspaceId: true },
  });
  return sole;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  if (!isChannelType(channel)) {
    return NextResponse.json({ ok: false, error: "Unknown channel" }, { status: 404 });
  }
  const challenge = getConnector(channel).verifyChallenge(new URL(req.url));
  if (challenge !== null) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  if (!isChannelType(channel)) {
    return NextResponse.json({ ok: false, error: "Unknown channel" }, { status: 404 });
  }

  const rl = rateLimit(`webhook:${channel}:${clientIp(req)}`, WEBHOOK_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const connector = getConnector(channel);
  const rawBody = await req.text();

  if (!connector.verifySignature(req.headers, rawBody)) {
    return NextResponse.json({ ok: false, error: "Signature verification failed" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  let kind: "message" | "status";
  try {
    kind = connector.classifyEvent(payload);
  } catch {
    kind = "message";
  }

  // Resolve the receiving account (→ workspace) from the provider's account ref.
  const ref = (() => {
    try {
      return connector.accountRef(payload);
    } catch {
      return null;
    }
  })();
  const account = await resolveAccount(channel, ref);

  // Event-level dedupe only when the provider gives a stable id; per-message and
  // status idempotency are enforced downstream.
  const dedupeKey =
    typeof p.eventId === "string"
      ? p.eventId
      : p.update_id != null
        ? `u:${String(p.update_id)}`
        : null;

  const event = await recordWebhookEvent({
    channelType: channel,
    channelAccountId: account?.id ?? null,
    workspaceId: account?.workspaceId ?? null,
    eventType: kind,
    dedupeKey,
    signatureValid: true,
    headers: pickHeaders(req.headers),
    payload,
  });
  if (event.duplicate) {
    await markWebhookEvent(event.id, "duplicate", { workspaceId: account?.workspaceId });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (kind === "status") {
      if (!account) {
        await markWebhookEvent(event.id, "ignored", { error: "No matching channel account" });
        return NextResponse.json({ ok: true, kind: "status", applied: 0, ignored: true });
      }
      let applied = 0;
      for (const u of connector.normalizeStatus(payload)) {
        if (await applyStatusUpdate(account.workspaceId, u.externalMessageId, u.status, u.error)) {
          applied++;
        }
      }
      await markWebhookEvent(event.id, "processed", { workspaceId: account.workspaceId });
      return NextResponse.json({ ok: true, kind: "status", applied });
    }

    const items = connector.normalizeWebhook(payload);
    // Demo connectors carry their own channelAccountId; live connectors rely on
    // the resolved account.
    let ingested = 0;
    let duplicates = 0;
    let lastConversationId: string | null = null;
    for (const item of items) {
      const channelAccountId = item.channelAccountId ?? account?.id ?? null;
      if (!channelAccountId) continue; // unknown account — can't ingest
      const result = await ingestInbound({ ...item, channelAccountId });
      lastConversationId = result.conversationId;
      if (result.duplicate) duplicates++;
      else ingested++;
    }

    if (ingested === 0 && duplicates === 0) {
      await markWebhookEvent(event.id, "ignored", {
        workspaceId: account?.workspaceId,
        error: "No ingestable messages / unknown account",
      });
      return NextResponse.json({ ok: true, ingested: 0, ignored: true });
    }
    await markWebhookEvent(event.id, ingested === 0 ? "duplicate" : "processed", {
      workspaceId: account?.workspaceId,
    });
    return NextResponse.json({ ok: true, ingested, duplicates, conversationId: lastConversationId });
  } catch (e) {
    const status = e instanceof ConnectorError ? 400 : 500;
    const error = e instanceof Error ? e.message : "Ingestion failed";
    await markWebhookEvent(event.id, "failed", { error });
    return NextResponse.json({ ok: false, error }, { status });
  }
}
