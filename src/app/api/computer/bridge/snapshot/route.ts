import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { computerBridgeEnabled } from "@/lib/computer-flag";
import { BRIDGE_MAX_BODY_BYTES, bridgeToken } from "@/lib/computer/bridge-http";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";
import {
  BridgeAuthError,
  BrowserPayloadError,
  recordBridgeSnapshot,
} from "@/lib/services/computer";

/**
 * C2 browser bridge — snapshot ingestion. One-way: the extension pushes a
 * bounded semantic observation of the tab the USER chose to share; nothing
 * ever flows back toward the page. The payload is validated as hostile
 * input (strict schema, no values/cookies/tokens representable) and stored
 * as UNTRUSTED observation data under the existing privacy lifecycle.
 */

export async function POST(req: Request) {
  if (!computerBridgeEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ip = clientIp(req.headers);
  const limit = await rateLimit(
    `computer-bridge:ip:${identifierKey(ip)}`,
    60,
    60_000,
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const token = bridgeToken(req);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > BRIDGE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > BRIDGE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await recordBridgeSnapshot(token, payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof BridgeAuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (error instanceof BrowserPayloadError || error instanceof ZodError) {
      // Fail closed on contract violations; never echo payload content.
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    throw error;
  }
}
