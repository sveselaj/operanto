import { NextResponse } from "next/server";
import { computerNavigationEnabled } from "@/lib/computer-flag";
import { BRIDGE_MAX_BODY_BYTES, bridgeToken } from "@/lib/computer/bridge-http";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";
import { BridgeAuthError } from "@/lib/services/computer";
import {
  claimNavigationCommand,
  reportNavigationResult,
} from "@/lib/services/computer-navigation";

/**
 * C4 action channel — deliberately separate from the C2 observation
 * channel and threat-modelled on its own terms.
 *
 * Two operations, both requiring the bridge bearer token AND a second
 * credential bound to one approved action:
 *   claim  — exchange the one-shot nonce for a navigation command
 *            (APPROVED → EXECUTING, atomic, single use)
 *   report — the extension reports the outcome; the server verifies from a
 *            fresh snapshot rather than trusting the report
 *
 * There is no endpoint that accepts a URL, a selector, or JavaScript: the
 * command is derived server-side from the deterministically bound action.
 * 404 when the navigation flag is off.
 */

export async function POST(req: Request) {
  if (!computerNavigationEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ip = clientIp(req.headers);
  const limit = await rateLimit(
    `computer-bridge:ip:${identifierKey(ip)}`,
    60,
    60_000,
    { sensitive: true },
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const token = bridgeToken(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > BRIDGE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const payload = body as {
    op?: unknown;
    nonce?: unknown;
    actionId?: unknown;
    ok?: unknown;
    error?: unknown;
  };

  try {
    if (payload.op === "claim") {
      if (typeof payload.nonce !== "string" || payload.nonce.length < 16) {
        return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
      }
      const command = await claimNavigationCommand(token, payload.nonce);
      return NextResponse.json({ ok: true, command });
    }
    if (payload.op === "report") {
      if (typeof payload.actionId !== "string" || typeof payload.ok !== "boolean") {
        return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
      }
      const result = await reportNavigationResult(token, payload.actionId, {
        ok: payload.ok,
        error: typeof payload.error === "string" ? payload.error : undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  } catch (error) {
    if (error instanceof BridgeAuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
