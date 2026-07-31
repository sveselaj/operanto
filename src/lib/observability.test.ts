import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureError, releaseInfo, scrub } from "@/lib/observability";

/**
 * Scrubbing is the security-critical half of error reporting: everything here
 * is about what must NOT leave the process.
 */

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("scrub", () => {
  it("redacts secrets at any depth and under any casing", () => {
    const out = scrub({
      Authorization: "Bearer abc",
      nested: {
        webhookSecretEncrypted: "v1:aaa:bbb:ccc",
        deeper: { tokenHash: "deadbeef", CRON_SECRET: "s3cret" },
      },
      headers: { "X-Operanto-Signature": "abcdef" },
    }) as Record<string, never>;
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("Bearer abc");
    expect(serialised).not.toContain("v1:aaa");
    expect(serialised).not.toContain("deadbeef");
    expect(serialised).not.toContain("s3cret");
    expect(serialised).not.toContain("abcdef");
    expect(serialised).toContain("[redacted]");
  });

  it("redacts personal data by default", () => {
    const out = JSON.stringify(
      scrub({
        customer: {
          name: "Arta Krasniqi",
          email: "arta@example.com",
          phone: "+38344123456",
        },
        message: "I would like to view the apartment",
      }),
    );
    expect(out).not.toContain("Arta");
    expect(out).not.toContain("arta@example.com");
    expect(out).not.toContain("38344123456");
    expect(out).not.toContain("view the apartment");
    expect(out).toContain("[pii]");
  });

  it("never forwards a raw inbound event payload", () => {
    const out = JSON.stringify(
      scrub({
        eventId: "evt_1",
        rawPayload: { data: { customer: { email: "x@y.z" } } },
      }),
    );
    expect(out).not.toContain("x@y.z");
    expect(out).toContain("evt_1"); // safe correlation handle is kept
  });

  it("keeps safe operational fields", () => {
    const out = scrub({ eventType: "lead.created", attempt: 3, ok: false });
    expect(out).toEqual({ eventType: "lead.created", attempt: 3, ok: false });
  });

  it("bounds depth, array length and string size", () => {
    let deep: Record<string, unknown> = { end: "value" };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(JSON.stringify(scrub(deep))).toContain("[truncated]");
    expect((scrub(new Array(200).fill("x")) as unknown[]).length).toBe(50);
    expect(String(scrub("y".repeat(900)))).toContain("[truncated]");
  });

  it("does not serialise unexpected objects blindly", () => {
    class Weird {
      secretField = "leak-me";
    }
    expect(scrub(new Weird())).toBe("[unserialisable]");
  });

  it("reduces Errors to name and message (no attached properties)", () => {
    const err = Object.assign(new Error("boom"), { token: "leak-me" });
    expect(scrub(err)).toEqual({ name: "Error", message: "boom" });
  });
});

describe("releaseInfo", () => {
  it("tags environment and release from the deployment", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    expect(releaseInfo()).toEqual({ environment: "production", release: "abc123" });
  });
});

describe("captureError", () => {
  it("logs locally and does not throw without a DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      captureError(new Error("boom"), {
        scope: "events.process_failed",
        tags: { eventType: "lead.created" },
        extra: { customer: { email: "a@b.c" } },
      }),
    ).resolves.toBeUndefined();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("a@b.c");
  });
});
