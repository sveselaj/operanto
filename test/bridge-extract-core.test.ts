import { describe, expect, it } from "vitest";
import {
  accessibleName,
  boundElements,
  buildPayload,
  isSafeNavigationTarget,
  mayExecuteNavigation,
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

describe("C4 extension-side navigation policy (independent enforcement)", () => {
  const PAGE = "https://deposit.fictionbank.test/eur/swift";

  it("mirrors the server safe-link rules", () => {
    expect(isSafeNavigationTarget("/orders", PAGE)).toBe(true);
    expect(isSafeNavigationTarget("/orders", PAGE, { target: "_blank" })).toBe(false);
    expect(isSafeNavigationTarget("/orders", PAGE, { download: true })).toBe(false);
    expect(isSafeNavigationTarget("javascript:alert(1)", PAGE)).toBe(false);
    expect(isSafeNavigationTarget("data:text/html,x", PAGE)).toBe(false);
    expect(isSafeNavigationTarget("https://attacker.example/x", PAGE)).toBe(false);
    expect(isSafeNavigationTarget("#top", PAGE)).toBe(false);
    expect(isSafeNavigationTarget("/orders", "http://localhost:3000/x")).toBe(true);
    expect(isSafeNavigationTarget("/orders", "http://evil.test/x")).toBe(false);
  });

  const command = {
    expectedHref: "https://deposit.fictionbank.test/orders",
    expectedOrigin: "https://deposit.fictionbank.test",
    observedUrl: PAGE,
  };

  it("executes only when the live page and element still match the approval", () => {
    expect(mayExecuteNavigation(command, { pageUrl: PAGE, foundHref: "/orders" })).toBe(
      true,
    );
  });

  it("refuses when the tab moved, the element vanished, or the href changed", () => {
    // Tab navigated elsewhere since the observation.
    expect(
      mayExecuteNavigation(command, {
        pageUrl: "https://deposit.fictionbank.test/other",
        foundHref: "/orders",
      }),
    ).toBe(false);
    // Element no longer present / ambiguous (inspector returns null href).
    expect(mayExecuteNavigation(command, { pageUrl: PAGE, foundHref: null })).toBe(false);
    // The anchor now points somewhere else — classic bait-and-switch.
    expect(
      mayExecuteNavigation(command, { pageUrl: PAGE, foundHref: "/withdraw-all" }),
    ).toBe(false);
    expect(
      mayExecuteNavigation(command, {
        pageUrl: PAGE,
        foundHref: "https://attacker.example/steal",
      }),
    ).toBe(false);
    // It became a new-tab or download link after approval.
    expect(
      mayExecuteNavigation(command, {
        pageUrl: PAGE,
        foundHref: "/orders",
        target: "_blank",
      }),
    ).toBe(false);
    expect(
      mayExecuteNavigation(command, {
        pageUrl: PAGE,
        foundHref: "/orders",
        download: true,
      }),
    ).toBe(false);
  });

  it("refuses a server command whose href and origin disagree (compromised server)", () => {
    expect(
      mayExecuteNavigation(
        {
          expectedHref: "https://attacker.example/steal",
          expectedOrigin: "https://deposit.fictionbank.test",
          observedUrl: PAGE,
        },
        { pageUrl: PAGE, foundHref: "https://attacker.example/steal" },
      ),
    ).toBe(false);
  });
});

describe("C4 privacy: extension refuses query/fragment destinations", () => {
  const PAGE = "https://deposit.fictionbank.test/eur/swift";

  it("rejects query- and fragment-bearing hrefs independently of the server", () => {
    expect(isSafeNavigationTarget("/orders?id=123", PAGE)).toBe(false);
    expect(isSafeNavigationTarget("/orders?token=secret", PAGE)).toBe(false);
    expect(isSafeNavigationTarget("/orders#details", PAGE)).toBe(false);
    expect(
      isSafeNavigationTarget("https://deposit.fictionbank.test/orders?s=1", PAGE),
    ).toBe(false);
    // The path-only equivalent stays allowed.
    expect(isSafeNavigationTarget("/orders", PAGE)).toBe(true);
  });

  it("refuses execution when a server command carries a query or fragment", () => {
    // Even if the server (buggy or compromised) hands over such a command.
    expect(
      mayExecuteNavigation(
        {
          expectedHref: "https://deposit.fictionbank.test/orders?token=secret",
          expectedOrigin: "https://deposit.fictionbank.test",
          observedUrl: PAGE,
        },
        { pageUrl: PAGE, foundHref: "/orders?token=secret" },
      ),
    ).toBe(false);
    expect(
      mayExecuteNavigation(
        {
          expectedHref: "https://deposit.fictionbank.test/orders#x",
          expectedOrigin: "https://deposit.fictionbank.test",
          observedUrl: PAGE,
        },
        { pageUrl: PAGE, foundHref: "/orders#x" },
      ),
    ).toBe(false);
  });

  it("refuses when the live anchor gained a query after approval", () => {
    expect(
      mayExecuteNavigation(
        {
          expectedHref: "https://deposit.fictionbank.test/orders",
          expectedOrigin: "https://deposit.fictionbank.test",
          observedUrl: PAGE,
        },
        { pageUrl: PAGE, foundHref: "/orders?token=leaked" },
      ),
    ).toBe(false);
  });

  it("page continuity compares origin+path, matching what Operanto persists", () => {
    // The stored observation URL is stripped by C2; a live tab URL with a
    // query must still be recognised as the same page (fail-open would be
    // wrong here — the TARGET checks remain strict).
    expect(
      mayExecuteNavigation(
        {
          expectedHref: "https://deposit.fictionbank.test/orders",
          expectedOrigin: "https://deposit.fictionbank.test",
          observedUrl: PAGE,
        },
        { pageUrl: `${PAGE}?tab=eur`, foundHref: "/orders" },
      ),
    ).toBe(true);
  });
});
