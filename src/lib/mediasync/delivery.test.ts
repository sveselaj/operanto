import { describe, it, expect, vi } from "vitest";

// delivery.ts imports the Prisma client at module load; stub it (these tests
// only exercise the pure `shouldAdvance` ordering logic).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { shouldAdvance } from "./delivery";

describe("shouldAdvance", () => {
  it("moves the status lifecycle forward", () => {
    expect(shouldAdvance("queued", "sent")).toBe(true);
    expect(shouldAdvance("sent", "delivered")).toBe(true);
    expect(shouldAdvance("delivered", "read")).toBe(true);
  });

  it("never moves backward", () => {
    expect(shouldAdvance("read", "delivered")).toBe(false);
    expect(shouldAdvance("delivered", "sent")).toBe(false);
    expect(shouldAdvance("read", "read")).toBe(false);
  });

  it("always applies a failure (unless already failed)", () => {
    expect(shouldAdvance("sent", "failed")).toBe(true);
    expect(shouldAdvance("delivered", "failed")).toBe(true);
    expect(shouldAdvance("failed", "failed")).toBe(false);
  });
});
