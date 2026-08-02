import { describe, expect, it } from "vitest";
import { detectConsentSignal } from "@/lib/channels/consent-keywords";

describe("consent keyword detection", () => {
  it("detects deliberate opt-out and opt-in keywords", () => {
    expect(detectConsentSignal("STOP")).toBe("opt_out");
    expect(detectConsentSignal("stop ")).toBe("opt_out");
    expect(detectConsentSignal("Unsubscribe")).toBe("opt_out");
    expect(detectConsentSignal("NDALO")).toBe("opt_out");
    expect(detectConsentSignal("START")).toBe("opt_in");
    expect(detectConsentSignal("opt in")).toBe("opt_in");
    expect(detectConsentSignal("fillo")).toBe("opt_in");
  });

  it("ignores keywords embedded in ordinary sentences", () => {
    expect(detectConsentSignal("please don't stop looking for apartments")).toBeNull();
    expect(detectConsentSignal("when does the promotion start next month?")).toBeNull();
    expect(detectConsentSignal("Hello, I ordered a nail set last week.")).toBeNull();
  });
});
