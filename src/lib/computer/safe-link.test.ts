import { describe, expect, it } from "vitest";
import {
  classifySafeLink,
  resolveSafeLink,
  type SafeLink,
} from "@/lib/computer/safe-link";

/**
 * The safe-link policy is the whole of what C4 may ever navigate. These
 * tests pin every rejection reason — the extension enforces the same rules
 * independently (test/bridge-extract-core.test.ts).
 */

const PAGE = "https://deposit.fictionbank.test/eur/swift";

const safe = (href: string, extra: Record<string, unknown> = {}) =>
  classifySafeLink({ href, pageUrl: PAGE, ...extra });

describe("classifySafeLink", () => {
  it("accepts a same-origin https anchor and returns the document URL", () => {
    const verdict = safe("/orders?tab=all#top");
    expect(verdict).toEqual({
      safe: true,
      url: "https://deposit.fictionbank.test/orders?tab=all",
      origin: "https://deposit.fictionbank.test",
    });
  });

  it("accepts loopback http for local development only", () => {
    expect(
      classifySafeLink({ href: "/orders", pageUrl: "http://localhost:3000/deposit" }).safe,
    ).toBe(true);
    expect(
      classifySafeLink({ href: "/orders", pageUrl: "http://evil.test/deposit" }).safe,
    ).toBe(false);
  });

  it("rejects every unsafe scheme", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>",
      "blob:https://deposit.fictionbank.test/x",
      "file:///etc/passwd",
      "mailto:a@b.test",
      "tel:+1",
    ]) {
      expect(safe(href)).toEqual({ safe: false, reason: "UNSAFE_SCHEME" });
    }
  });

  it("rejects cross-origin, new tabs, downloads, fragments and credentials", () => {
    expect(safe("https://attacker.example/steal")).toEqual({
      safe: false,
      reason: "CROSS_ORIGIN",
    });
    expect(safe("https://sub.fictionbank.test/x")).toEqual({
      safe: false,
      reason: "CROSS_ORIGIN",
    });
    expect(safe("/orders", { target: "_blank" })).toEqual({
      safe: false,
      reason: "NEW_TAB",
    });
    expect(safe("/orders", { target: "someframe" })).toEqual({
      safe: false,
      reason: "NEW_TAB",
    });
    expect(safe("/report.pdf", { hasDownload: true })).toEqual({
      safe: false,
      reason: "DOWNLOAD",
    });
    expect(safe("#section")).toEqual({ safe: false, reason: "FRAGMENT_ONLY" });
    expect(safe("/eur/swift#step2")).toEqual({ safe: false, reason: "FRAGMENT_ONLY" });
    expect(safe("https://user:pw@deposit.fictionbank.test/orders")).toEqual({
      safe: false,
      reason: "EMBEDDED_CREDENTIALS",
    });
  });

  it("accepts explicit same-tab targets", () => {
    expect(safe("/orders", { target: "_self" }).safe).toBe(true);
  });
});

describe("resolveSafeLink", () => {
  const links: SafeLink[] = [
    { ref: "l0", role: "link", name: "Orders", href: `https://x.test/orders` },
    { ref: "l1", role: "link", name: "Help", href: `https://x.test/help` },
  ];

  it("resolves by ephemeral ref and by unique name", () => {
    expect(resolveSafeLink(links, { ref: "l0" })).toEqual({ ok: true, link: links[0] });
    expect(resolveSafeLink(links, { name: "orders" })).toEqual({
      ok: true,
      link: links[0],
    });
  });

  it("fails closed on missing and ambiguous targets", () => {
    expect(resolveSafeLink(links, { ref: "nope" })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    const dupes = [...links, { ref: "l2", role: "link" as const, name: "Orders", href: "https://x.test/o2" }];
    expect(resolveSafeLink(dupes, { name: "Orders" })).toEqual({
      ok: false,
      reason: "AMBIGUOUS",
    });
  });
});
