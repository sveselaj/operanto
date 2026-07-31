import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit, redisConfigured } from "@/lib/rate-limit";

/**
 * The failure policy is the part worth testing: a limiter that silently stops
 * limiting is worse than none, so sensitive limits must refuse rather than
 * degrade when the shared backend is configured but unreachable.
 */

const KEY = () => `test:${Math.random()}`;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("without Redis configured", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  it("reports unconfigured and counts in memory", async () => {
    expect(redisConfigured()).toBe(false);
    const key = KEY();
    expect(await rateLimit(key, 2, 60_000)).toMatchObject({
      allowed: true,
      backend: "memory",
    });
    expect((await rateLimit(key, 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit(key, 2, 60_000)).allowed).toBe(false);
  });

  it("still limits sensitive calls in memory (no Redis to fail over from)", async () => {
    const key = KEY();
    await rateLimit(key, 1, 60_000, { sensitive: true });
    const second = await rateLimit(key, 1, 60_000, { sensitive: true });
    expect(second.allowed).toBe(false);
    expect(second.backend).toBe("memory");
  });
});

describe("with Redis configured", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  });

  it("uses the shared counter when reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ result: 3 }, { result: 1 }]), {
          status: 200,
        }),
      ),
    );
    const verdict = await rateLimit(KEY(), 5, 60_000);
    expect(verdict).toMatchObject({ allowed: true, remaining: 2, backend: "redis" });
  });

  it("denies over-limit from the shared counter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ result: 11 }, { result: 1 }]), {
          status: 200,
        }),
      ),
    );
    expect((await rateLimit(KEY(), 10, 60_000)).allowed).toBe(false);
  });

  it("FAILS CLOSED for sensitive limits when Redis is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const verdict = await rateLimit(KEY(), 10, 60_000, { sensitive: true });
    expect(verdict.allowed).toBe(false);
    expect(verdict.backend).toBe("denied-fail-closed");
  });

  it("falls back to memory for non-sensitive limits when Redis is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const verdict = await rateLimit(KEY(), 10, 60_000);
    expect(verdict.allowed).toBe(true);
    expect(verdict.backend).toBe("memory");
  });

  it("treats a non-2xx Redis response the same as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    expect(
      (await rateLimit(KEY(), 10, 60_000, { sensitive: true })).backend,
    ).toBe("denied-fail-closed");
  });
});

describe("identifierKey", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret"));

  it("never exposes the raw identifier", async () => {
    const { identifierKey } = await import("@/lib/rate-limit");
    const key = identifierKey("Person@Example.COM");
    expect(key).not.toContain("Person");
    expect(key).not.toContain("example.com");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable and case/whitespace insensitive", async () => {
    const { identifierKey } = await import("@/lib/rate-limit");
    expect(identifierKey(" Person@Example.com ")).toBe(
      identifierKey("person@example.com"),
    );
  });

  it("separates different identifiers", async () => {
    const { identifierKey } = await import("@/lib/rate-limit");
    expect(identifierKey("a@example.com")).not.toBe(identifierKey("b@example.com"));
  });

  it("is keyed by AUTH_SECRET, so counters are not dictionary-reversible", async () => {
    const { identifierKey } = await import("@/lib/rate-limit");
    const withFirst = identifierKey("person@example.com");
    vi.stubEnv("AUTH_SECRET", "a-different-secret");
    expect(identifierKey("person@example.com")).not.toBe(withFirst);
  });
});
