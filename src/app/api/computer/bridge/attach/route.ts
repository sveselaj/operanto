import { NextResponse } from "next/server";
import { computerBridgeEnabled } from "@/lib/computer-flag";
import { bridgeToken } from "@/lib/computer/bridge-http";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";
import {
  BridgeAuthError,
  attachComputerBridgeByToken,
} from "@/lib/services/computer";

/**
 * C2 browser bridge — attach (extension-side pairing). Bearer-token only:
 * no cookies, no session, no CSRF surface. The token is the short-lived,
 * session-bound grant minted in the cockpit; first use claims it.
 * Flag off → 404 (the route does not exist as far as callers can tell).
 */

export async function POST(req: Request) {
  if (!computerBridgeEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ip = clientIp(req.headers);
  const limit = await rateLimit(`computer-bridge:ip:${identifierKey(ip)}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const token = bridgeToken(req);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const attached = await attachComputerBridgeByToken(token);
    return NextResponse.json({
      ok: true,
      bridgeId: attached.bridgeId,
      sessionId: attached.sessionId,
      expiresAt: attached.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof BridgeAuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
