import { NextResponse } from "next/server";
import { computerBridgeEnabled } from "@/lib/computer-flag";
import { bridgeToken } from "@/lib/computer/bridge-http";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";
import {
  BridgeAuthError,
  detachComputerBridgeByToken,
} from "@/lib/services/computer";

/** C2 browser bridge — extension-side detach. Observation stops here. */

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
  try {
    await detachComputerBridgeByToken(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BridgeAuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
