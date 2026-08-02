import { describe, expect, it } from "vitest";
import { shouldAdvance } from "@/lib/channels/delivery";

describe("delivery state machine", () => {
  it("only ever moves forward", () => {
    expect(shouldAdvance("QUEUED", "SENT")).toBe(true);
    expect(shouldAdvance("SENT", "DELIVERED")).toBe(true);
    expect(shouldAdvance("DELIVERED", "READ")).toBe(true);
    expect(shouldAdvance("DELIVERED", "SENT")).toBe(false);
    expect(shouldAdvance("READ", "DELIVERED")).toBe(false);
    expect(shouldAdvance("SENT", "SENT")).toBe(false);
  });

  it("FAILED is reachable from pre-terminal states and terminal itself", () => {
    expect(shouldAdvance("QUEUED", "FAILED")).toBe(true);
    expect(shouldAdvance("DELIVERED", "FAILED")).toBe(true);
    expect(shouldAdvance("FAILED", "SENT")).toBe(false);
    expect(shouldAdvance("READ", "FAILED")).toBe(false);
  });

  it("RECORDED is frozen — the local/unsent invariant", () => {
    for (const to of ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"] as const) {
      expect(shouldAdvance("RECORDED", to)).toBe(false);
    }
  });
});
