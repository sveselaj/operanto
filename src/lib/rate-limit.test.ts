import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentEnvironment, namespacedKey, rateLimit, redisConfigured } from "@/lib/rate-limit";

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

describe("e2e rate-limit namespace isolation (environment policy)", () => {
  afterEach(() => vi.unstubAllEnvs());

  function stubEnvBase() {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("OPERANTO_ENV", "");
    vi.stubEnv("CI", "");
    vi.stubEnv("OPERANTO_RATE_LIMIT_TEST_NAMESPACE", "run-42");
  }

  it("test environment permits a configured namespace", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "test");
    expect(namespacedKey("login:acct:x")).toBe("testns:run-42:login:acct:x");
  });

  it("CI environment permits it", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "true");
    expect(namespacedKey("login:acct:x")).toBe("testns:run-42:login:acct:x");
  });

  it("explicitly configured staging permits it", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPERANTO_ENV", "staging");
    expect(namespacedKey("login:acct:x")).toBe("testns:run-42:login:acct:x");
  });

  it("preview permits it", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(namespacedKey("login:acct:x")).toBe("testns:run-42:login:acct:x");
  });

  it("production refuses it, and an unknown environment fails closed", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "production");
    expect(deploymentEnvironment()).toBe("production");
    expect(namespacedKey("login:acct:x")).toBe("login:acct:x");
    vi.stubEnv("OPERANTO_ENV", "production");
    vi.stubEnv("NODE_ENV", "test");
    expect(namespacedKey("login:acct:x")).toBe("login:acct:x");
  });

  it("VERCEL_ENV=production overrides any permissive application setting", () => {
    stubEnvBase();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OPERANTO_ENV", "staging");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CI", "true");
    expect(deploymentEnvironment()).toBe("production");
    expect(namespacedKey("login:acct:x")).toBe("login:acct:x");
  });

  it("client-supplied namespace input is ignored — only the env var counts", () => {
    // The namespace comes exclusively from process.env; nothing in the rate
    // limiter reads a request. A hostile key that IMITATES a namespaced key
    // is treated as an opaque key, never as a namespace instruction.
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPERANTO_RATE_LIMIT_TEST_NAMESPACE", "");
    expect(namespacedKey("testns:evil:login:acct:x")).toBe(
      "testns:evil:login:acct:x",
    );
    // And with a real namespace active, the hostile prefix stays inside the
    // key — the account/IP dimension is preserved, never replaced.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPERANTO_RATE_LIMIT_TEST_NAMESPACE", "run-42");
    expect(namespacedKey("testns:evil:login:acct:x")).toBe(
      "testns:run-42:testns:evil:login:acct:x",
    );
  });

  it("ordinary production keys are byte-identical with and without the variable", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "production");
    const withNamespace = namespacedKey("ingest:ip:abc");
    vi.stubEnv("OPERANTO_RATE_LIMIT_TEST_NAMESPACE", "");
    const without = namespacedKey("ingest:ip:abc");
    expect(withNamespace).toBe("ingest:ip:abc");
    expect(withNamespace).toBe(without);
  });

  it("sanitises hostile namespace values", () => {
    stubEnvBase();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPERANTO_RATE_LIMIT_TEST_NAMESPACE", "a b:c*d" + "x".repeat(100));
    const key = namespacedKey("k");
    expect(key.startsWith("testns:")).toBe(true);
    expect(key).not.toContain(" ");
    expect(key).not.toContain("*");
    expect(key.length).toBeLessThan(70);
  });
});
