import { describe, it, expect } from "vitest";
import { detectConsentSignal } from "./consent-keywords";

describe("detectConsentSignal", () => {
  it("detects opt-out keywords (en + sq)", () => {
    expect(detectConsentSignal("STOP")).toBe("opt_out");
    expect(detectConsentSignal("stop")).toBe("opt_out");
    expect(detectConsentSignal("Unsubscribe")).toBe("opt_out");
    expect(detectConsentSignal("ndalo")).toBe("opt_out");
  });

  it("detects opt-in keywords", () => {
    expect(detectConsentSignal("START")).toBe("opt_in");
    expect(detectConsentSignal("po")).toBe("opt_in");
  });

  it("tolerates surrounding punctuation/whitespace", () => {
    expect(detectConsentSignal("  STOP. ")).toBe("opt_out");
  });

  it("does NOT fire on multi-word messages containing the keyword", () => {
    expect(detectConsentSignal("please stop sending the wrong size")).toBeNull();
    expect(detectConsentSignal("can you start my order?")).toBeNull();
  });

  it("returns null for empty/non-command messages", () => {
    expect(detectConsentSignal("")).toBeNull();
    expect(detectConsentSignal(null)).toBeNull();
    expect(detectConsentSignal("how much is a haircut?")).toBeNull();
  });
});
