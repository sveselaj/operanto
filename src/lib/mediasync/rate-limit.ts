/**
 * MediaSync — in-memory fixed-window rate limiter.
 *
 * Guards the public webhook ingestion endpoint against bursts/abuse. This is a
 * per-process limiter (sufficient for the single-node MVP / demo); swap the
 * store for Redis when Operanto scales horizontally — the call site stays the
 * same.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = { limit: number; windowMs: number };
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
};

/**
 * Record a hit for `key` and report whether it is allowed. `now` is injectable
 * for deterministic tests.
 */
export function rateLimit(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now(),
): RateLimitResult {
  const { limit, windowMs } = opts;
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt, limit };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt, limit };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    limit,
  };
}

/** Clear all buckets — test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}
