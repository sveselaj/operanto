import "server-only";
import { createHmac } from "node:crypto";

/**
 * Fixed-window rate limiter.
 *
 * ONE configuration convention: the Upstash REST pair
 * (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). A bare `REDIS_URL`
 * is deliberately unsupported — two conventions means one of them is silently
 * ignored, and a rate limiter that is silently not running is worse than none.
 *
 * Without the pair, counters are per-instance and in-memory: correct on a
 * single instance, and an under-count across several. With it, counters are
 * shared.
 *
 * Failure policy (see `docs/security.md`): when Redis is configured but
 * unreachable, non-sensitive limits fall back to the in-memory window
 * (fail-open, availability first), while limits marked `sensitive` DENY
 * (fail-closed). Authentication and invitation limits are sensitive: an
 * attacker who can knock Redis over must not thereby gain unlimited password
 * guesses.
 *
 * Counters in use — all fixed-window, all expiring with the window:
 *
 * | Key                    | Identifier        | Limit | Window | On outage   |
 * |------------------------|-------------------|-------|--------|-------------|
 * | `login:acct:<hash>`    | HMAC(email)       | 10    | 15 min | fail closed |
 * | `login:ip:<hash>`      | HMAC(client IP)   | 40    | 15 min | fail closed |
 * | `invite:ip:<hash>`     | HMAC(client IP)   | 10    | 15 min | fail closed |
 * | `ingest:ip:<hash>`     | HMAC(client IP)   | 240   | 1 min  | memory      |
 *
 * Identifiers are pseudonymised with `identifierKey()` — no raw email, IP,
 * password, token or signature is ever part of a key. Redis expiry is set to
 * the window length on every INCR, so counters cannot outlive their window.
 */

type Verdict = {
  allowed: boolean;
  remaining: number;
  /** Which backend produced the verdict — surfaced for operational logging. */
  backend: "redis" | "memory" | "denied-fail-closed";
};

/**
 * Pseudonymise an identifier before it becomes part of a key.
 *
 * Redis keys are visible to anyone with console access and appear in slow-log
 * and monitoring output, so raw email addresses (and IPs) must not be written
 * there. The hash is keyed with AUTH_SECRET so the values are not reversible
 * with a dictionary of candidate addresses; a rotated AUTH_SECRET simply
 * starts a fresh set of counters, which is harmless.
 */
export function identifierKey(value: string): string {
  const secret = process.env.AUTH_SECRET ?? "operanto-dev-fallback";
  return createHmac("sha256", secret)
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

type Options = {
  /**
   * Fail CLOSED when a configured Redis is unreachable, instead of falling
   * back to per-instance memory. Use for authentication-adjacent limits.
   */
  sensitive?: boolean;
};

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowMs: number): Verdict {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, backend: "memory" };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    backend: "memory",
  };
}

export function redisConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/** Returns null when Redis is not configured OR is unreachable. */
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
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result: number }>;
    const count = data[0]?.result ?? 0;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      backend: "redis",
    };
  } catch {
    return null;
  }
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: Options = {},
): Promise<Verdict> {
  const shared = await redisLimit(key, limit, windowMs);
  if (shared) return shared;

  // Configured but unreachable: sensitive limits refuse rather than degrade
  // into a per-instance counter an attacker can trivially out-scale.
  if (options.sensitive && redisConfigured()) {
    console.error(
      "[rate-limit] shared backend unavailable; denying sensitive request",
    );
    return { allowed: false, remaining: 0, backend: "denied-fail-closed" };
  }

  return memoryLimit(key, limit, windowMs);
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
