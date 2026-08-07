import { z } from "zod";

/**
 * Safe-link policy (Computer C4) — the single, shared definition of what
 * may ever be navigated. Pure and dependency-free so the SERVER enforces it
 * at capture, proposal, approval and execution-claim time, and the
 * EXTENSION enforces the same rules independently immediately before
 * navigating. Server approval is necessary but NOT sufficient: a
 * compromised or buggy server must not be able to talk the extension into
 * an unsafe navigation.
 *
 * A link is safe only if ALL hold:
 *  - it is a real anchor with an href;
 *  - the scheme is https (or http on a loopback host, for local dev);
 *  - it is SAME-ORIGIN with the page it was observed on;
 *  - it carries no target that opens a new tab/window;
 *  - it is not a download;
 *  - it is not javascript:, data:, blob:, file:, mailto:, tel:, etc.;
 *  - it is not a bare fragment (no navigation) — nothing to verify;
 *  - it has NO query component and NO fragment (see below).
 *
 * PRIVACY: query strings and fragments routinely carry session ids, signed
 * tokens, customer identifiers and other secrets. C2 established that
 * persisted page URLs are origin + pathname only. C4 preserves that
 * invariant mechanically by REJECTING query/fragment-bearing destinations
 * outright rather than stripping and navigating — stripping would change
 * where the human's approval actually leads, and the raw values must never
 * be persisted, audited, or handed to the extension. C4 therefore permits
 * simple same-origin PATH navigation only. This is an intentional C4
 * restriction, not a permanent product limitation: query-bearing links
 * need a separately reviewed privacy-preserving destination identity
 * (likely a normalized fingerprint, never raw query values).
 *
 * Buttons, JS-driven elements, form submits, arbitrary selectors and
 * model-supplied URLs are NOT navigable in C4 and have no representation
 * here at all.
 */

export const SAFE_LINK_LIMITS = {
  refMax: 64,
  hrefMax: 2000,
  nameMax: 300,
  perSnapshot: 50,
} as const;

export type SafeLinkCandidate = {
  href: string;
  /** Absolute URL of the page the anchor was observed on. */
  pageUrl: string;
  target?: string | null;
  hasDownload?: boolean;
};

export type SafeLinkRejection =
  | "NOT_ABSOLUTE"
  | "UNSAFE_SCHEME"
  | "CROSS_ORIGIN"
  | "NEW_TAB"
  | "DOWNLOAD"
  | "FRAGMENT_ONLY"
  | "EMBEDDED_CREDENTIALS"
  /** Privacy: the destination carries a query component (C4 restriction). */
  | "HAS_QUERY"
  /** Privacy: the destination carries a fragment (C4 restriction). */
  | "HAS_FRAGMENT";

export type SafeLinkVerdict =
  | { safe: true; url: string; origin: string }
  | { safe: false; reason: SafeLinkRejection };

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}

export function classifySafeLink(candidate: SafeLinkCandidate): SafeLinkVerdict {
  const rawHref = (candidate.href ?? "").trim();
  if (!rawHref) return { safe: false, reason: "NOT_ABSOLUTE" };
  if (candidate.hasDownload) return { safe: false, reason: "DOWNLOAD" };
  // Any target that is not an explicit same-tab value opens elsewhere.
  const target = (candidate.target ?? "").trim().toLowerCase();
  if (target && target !== "_self") return { safe: false, reason: "NEW_TAB" };

  let page: URL;
  try {
    page = new URL(candidate.pageUrl);
  } catch {
    return { safe: false, reason: "NOT_ABSOLUTE" };
  }

  // Reject dangerous schemes BEFORE resolution: a relative-looking
  // "javascript:..." must never be resolved against the page.
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    const scheme = rawHref.slice(0, rawHref.indexOf(":")).toLowerCase();
    if (scheme !== "https" && scheme !== "http") {
      return { safe: false, reason: "UNSAFE_SCHEME" };
    }
  }
  if (rawHref.startsWith("#")) return { safe: false, reason: "FRAGMENT_ONLY" };

  let resolved: URL;
  try {
    resolved = new URL(rawHref, page);
  } catch {
    return { safe: false, reason: "NOT_ABSOLUTE" };
  }
  if (resolved.username || resolved.password) {
    return { safe: false, reason: "EMBEDDED_CREDENTIALS" };
  }
  if (resolved.protocol !== "https:") {
    if (!(resolved.protocol === "http:" && isLoopback(resolved.hostname))) {
      return { safe: false, reason: "UNSAFE_SCHEME" };
    }
  }
  if (resolved.origin !== page.origin) return { safe: false, reason: "CROSS_ORIGIN" };
  // Same page + only a fragment differs → no navigation to verify.
  if (
    resolved.hash &&
    `${resolved.origin}${resolved.pathname}${resolved.search}` ===
      `${page.origin}${page.pathname}${page.search}`
  ) {
    return { safe: false, reason: "FRAGMENT_ONLY" };
  }
  // Privacy (C4): reject — never strip-and-navigate. A stripped URL would
  // send the human somewhere other than what they approved, and the raw
  // values must not be persisted, audited, or handed to the extension.
  if (resolved.hash) return { safe: false, reason: "HAS_FRAGMENT" };
  if (resolved.search) return { safe: false, reason: "HAS_QUERY" };

  const url = `${resolved.origin}${resolved.pathname}`;
  if (url.length > SAFE_LINK_LIMITS.hrefMax) {
    return { safe: false, reason: "NOT_ABSOLUTE" };
  }
  return { safe: true, url, origin: resolved.origin };
}

/**
 * A snapshot-scoped ephemeral element identity. `ref` is meaningful ONLY
 * inside its snapshot — it is not a selector and cannot be reused across
 * captures. Persisted on ComputerSnapshot.safeLinksJson.
 */
export const safeLinkSchema = z
  .object({
    ref: z
      .string()
      .min(1)
      .max(SAFE_LINK_LIMITS.refMax)
      .regex(/^[A-Za-z0-9_-]+$/),
    role: z.literal("link"),
    name: z.string().min(1).max(SAFE_LINK_LIMITS.nameMax),
    /**
     * Absolute, same-origin, https (or loopback http), PATH ONLY —
     * server-verified. The `?`/`#` refusal is repeated here as a
     * persistence-layer backstop: even a bug elsewhere cannot write a
     * query- or fragment-bearing URL into safeLinksJson.
     */
    href: z
      .string()
      .min(1)
      .max(SAFE_LINK_LIMITS.hrefMax)
      .refine((value) => !value.includes("?") && !value.includes("#"), {
        message: "Safe links are path-only: no query or fragment may be persisted",
      }),
  })
  .strict();

export const safeLinksSchema = z.array(safeLinkSchema).max(SAFE_LINK_LIMITS.perSnapshot);

export type SafeLink = z.infer<typeof safeLinkSchema>;

/**
 * Resolve a target the human approved to exactly one safe link in a
 * snapshot. Ambiguity (two links with the same name) fails closed — the
 * operator must capture again or choose differently.
 */
export function resolveSafeLink(
  links: SafeLink[],
  selector: { ref?: string; name?: string },
): { ok: true; link: SafeLink } | { ok: false; reason: "NOT_FOUND" | "AMBIGUOUS" } {
  const matches = selector.ref
    ? links.filter((link) => link.ref === selector.ref)
    : links.filter(
        (link) =>
          link.name.trim().toLowerCase() === (selector.name ?? "").trim().toLowerCase(),
      );
  if (matches.length === 0) return { ok: false, reason: "NOT_FOUND" };
  if (matches.length > 1) return { ok: false, reason: "AMBIGUOUS" };
  return { ok: true, link: matches[0] };
}
