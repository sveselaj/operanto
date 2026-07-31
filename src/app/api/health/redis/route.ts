import { NextResponse } from "next/server";

/**
 * Safely public: reports whether shared rate limiting has a Redis backend and
 * whether it answers. Never echoes URLs, tokens, or error details.
 */
export async function GET() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // In-memory fallback is active — degraded but functional by design.
    return NextResponse.json({ ok: true, configured: false });
  }
  const startedAt = Date.now();
  try {
    const res = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("ping failed");
    return NextResponse.json({
      ok: true,
      configured: true,
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json({ ok: false, configured: true }, { status: 503 });
  }
}
