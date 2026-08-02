import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The simulator's guard rails, checked without a database: it must refuse to
 * run in production unless explicitly enabled, and reject malformed run ids
 * before any query. Behaviour against a real database is covered in
 * test/conversations.integration.test.ts.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), auditSystem: vi.fn() }));

const { ingestSimulatedMessage, isSimulatorEnabled, SIMULATOR_SCENARIOS } =
  await import("@/lib/services/conversation-simulator");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production gating", () => {
  it("is enabled outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isSimulatorEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isSimulatorEnabled()).toBe(true);
  });

  it("is disabled in production unless explicitly opted in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPERANTO_SIMULATOR_ENABLED", "");
    expect(isSimulatorEnabled()).toBe(false);
    vi.stubEnv("OPERANTO_SIMULATOR_ENABLED", "1");
    expect(isSimulatorEnabled()).toBe(true);
  });

  it("refuses to ingest in production before touching the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPERANTO_SIMULATOR_ENABLED", "");
    // prisma is an empty stub: reaching any query would throw a TypeError,
    // not this message — so the guard provably fires first.
    await expect(ingestSimulatedMessage("org_1", "nagelista")).rejects.toThrow(
      /disabled in production/,
    );
  });
});

describe("scenario determinism", () => {
  it("scenarios carry fixed, non-random identifiers", () => {
    expect(SIMULATOR_SCENARIOS.nagelista.providerThreadId).toBe(
      "sim-nagelista-thread-001",
    );
    expect(SIMULATOR_SCENARIOS.pronatona.providerMessageId).toBe(
      "sim-pronatona-msg-001",
    );
  });

  it("rejects malformed run ids before any query", async () => {
    await expect(
      ingestSimulatedMessage("org_1", "nagelista", { runId: "bad run id!" }),
    ).rejects.toThrow(/runId/);
  });
});
