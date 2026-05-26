import { NextResponse } from "next/server";
import { getConnector, isChannelType, ConnectorError } from "@/lib/channels";
import { ingestInbound } from "@/lib/services/ingestion";

/**
 * Public webhook ingestion endpoint: POST /api/webhooks/{channel}
 *
 * Demo channels (webchat/manual) accept a normalized JSON body gated by the
 * unguessable channelAccountId. Real providers verify a signature first.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  if (!isChannelType(channel)) {
    return NextResponse.json({ ok: false, error: "Unknown channel" }, { status: 404 });
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

  try {
    const normalized = connector.normalizeWebhook(payload);
    const result = await ingestInbound(normalized);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = e instanceof ConnectorError ? 400 : 500;
    const error = e instanceof Error ? e.message : "Ingestion failed";
    return NextResponse.json({ ok: false, error }, { status });
  }
}
