import "server-only";

/**
 * Fixed-window rate limiter.
 *
 * With UPSTASH_REDIS_REST_URL configured the window counters are shared across
 * instances (INCR + EXPIRE via the REST pipeline API — no SDK dependency).
 * Without it, falls back to a per-instance in-memory map, which is adequate
 * for single-instance deployments and local development. Fail-open: an
 * unreachable Redis never blocks legitimate traffic.
 */

type Verdict = { allowed: boolean; remaining: number };

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowMs: number): Verdict {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

async function redisLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<Verdict | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const windowSeconds = Math.ceil(windowMs / 1000);
    const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", bucket],
        ["EXPIRE", bucket, String(windowSeconds)],
      ]),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result: number }>;
    const count = data[0]?.result ?? 0;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return null; // fail open, fall back to memory
  }
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<Verdict> {
  const shared = await redisLimit(key, limit, windowMs);
  return shared ?? memoryLimit(key, limit, windowMs);
}

/** Best-effort client IP from proxy headers (rightmost X-Forwarded-For hop). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim());
    return parts[parts.length - 1] || "unknown";
  }
  return headers.get("x-real-ip") ?? "unknown";
}
