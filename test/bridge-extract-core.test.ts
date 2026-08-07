import { describe, expect, it } from "vitest";
import {
  accessibleName,
  boundElements,
  buildPayload,
  stripUrl,
  toSemanticElement,
} from "../extension/computer-bridge/extract-core.js";

/**
 * The extension's pure extraction core. The server sanitizer remains the
 * authoritative gate; these tests pin the CLIENT-side hygiene rules so the
 * packaged extractor (popup.js mirrors this module) cannot silently start
 * shipping values, secrets, or unbounded content.
 */

describe("stripUrl", () => {
  it("keeps origin + pathname, drops query and fragment", () => {
    expect(
      stripUrl("https://deposit.fictionbank.test/eur/swift?session=SECRET#step2"),
    ).toBe("https://deposit.fictionbank.test/eur/swift");
  });

  it("refuses non-http(s) schemes", () => {
    expect(stripUrl("chrome://settings")).toBe("");
    expect(stripUrl("file:///etc/passwd")).toBe("");
    expect(stripUrl("not a url")).toBe("");
  });
});

describe("toSemanticElement", () => {
  it("skips password and hidden inputs entirely — not even their names", () => {
    expect(
      toSemanticElement({
        tag: "input",
        typeAttr: "password",
        nameCandidates: ["Password"],
      }),
    ).toBeNull();
    expect(
      toSemanticElement({
        tag: "input",
        typeAttr: "hidden",
        nameCandidates: ["csrf_token"],
      }),
    ).toBeNull();
  });

  it("derives roles from tags and never carries values", () => {
    const element = toSemanticElement({
      tag: "button",
      nameCandidates: ["I've sent the funds"],
    });
    expect(element).toEqual({ role: "button", name: "I've sent the funds" });
    expect(Object.keys(element!)).toEqual(["role", "name"]);
  });

  it("drops unnamed non-input elements and unknown tags", () => {
    expect(toSemanticElement({ tag: "a", nameCandidates: [""] })).toBeNull();
    expect(toSemanticElement({ tag: "div", nameCandidates: ["x"] })).toBeNull();
  });
});

describe("accessibleName / bounds", () => {
  it("first non-empty candidate wins, whitespace collapsed, length bounded", () => {
    expect(accessibleName(["", null, "  Deposit   EUR  "])).toBe("Deposit EUR");
    expect(accessibleName(["x".repeat(500)]).length).toBe(300);
  });

  it("element list is hard-capped", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      role: "link",
      name: `link ${i}`,
    }));
    expect(boundElements(many)).toHaveLength(200);
  });
});

describe("buildPayload", () => {
  it("assembles a bounded payload with stripped url", () => {
    const payload = buildPayload({
      url: "https://deposit.fictionbank.test/eur/swift?token=abc",
      title: "Deposit EUR — FictionBank",
      visibleText: "  Transfers arrive in 0-5 business days  ",
      elements: [{ role: "link", name: "Orders" }],
      captureId: "cap-1",
    });
    expect(payload).toEqual({
      url: "https://deposit.fictionbank.test/eur/swift",
      captureId: "cap-1",
      title: "Deposit EUR — FictionBank",
      visibleText: "Transfers arrive in 0-5 business days",
      elements: [{ role: "link", name: "Orders" }],
    });
  });
});
