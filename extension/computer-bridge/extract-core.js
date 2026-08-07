/**
 * Pure extraction/sanitization core for the Operanto Computer Bridge (C2).
 *
 * These functions are DOM-free and side-effect-free so they can be unit
 * tested from the repository test suite (test/bridge-extract-core.test.ts)
 * without browser packaging. The injected page function in popup.js mirrors
 * this logic; the SERVER sanitizer (src/lib/computer/browser-payload.ts)
 * remains the authoritative gate — the extension is best-effort hygiene,
 * never the security boundary.
 *
 * Hard rules encoded here:
 * - elements carry role + accessible name ONLY — never values;
 * - password/hidden inputs are skipped entirely;
 * - URLs are stripped to origin + pathname (query/hash carry tokens);
 * - all text is bounded.
 */

export const EXTRACT_LIMITS = {
  name: 300,
  role: 60,
  elements: 200,
  visibleText: 4000,
  title: 500,
};

/** Strip a page URL to origin + pathname; empty string when not http(s). */
export function stripUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  return `${parsed.origin}${parsed.pathname}`;
}

export function truncate(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Resolve an accessible name from the candidates a DOM walker collects:
 * aria-label, associated label text, text content, placeholder, alt, title
 * attribute — first non-empty wins. Field VALUES are never candidates.
 */
export function accessibleName(candidates) {
  for (const candidate of candidates) {
    const name = truncate(candidate ?? "", EXTRACT_LIMITS.name);
    if (name) return name;
  }
  return "";
}

/**
 * Map a walker-provided descriptor to a semantic element, or null when it
 * must be skipped. The descriptor is data the walker read from a node:
 * { tag, typeAttr, roleAttr, nameCandidates }.
 */
export function toSemanticElement(descriptor) {
  const tag = String(descriptor.tag ?? "").toLowerCase();
  const typeAttr = String(descriptor.typeAttr ?? "").toLowerCase();

  // Never observe secret-bearing or invisible fields — not even their names.
  if (typeAttr === "password" || typeAttr === "hidden") return null;

  let role = String(descriptor.roleAttr ?? "").toLowerCase();
  if (!role) {
    if (tag === "a") role = "link";
    else if (tag === "button" || typeAttr === "submit" || typeAttr === "button")
      role = "button";
    else if (tag === "select") role = "combobox";
    else if (tag === "textarea" || tag === "input") role = "textbox";
    else if (/^h[1-6]$/.test(tag)) role = "heading";
    else return null;
  }
  role = truncate(role, EXTRACT_LIMITS.role);

  const name = accessibleName(descriptor.nameCandidates ?? []);
  if (!name && role !== "textbox" && role !== "combobox") return null;

  return { role, name };
}

/** Bound the element list; excess elements are dropped, never truncated into junk. */
export function boundElements(elements) {
  return elements
    .filter(Boolean)
    .slice(0, EXTRACT_LIMITS.elements);
}

/** Assemble the payload the popup POSTs to the ingestion endpoint. */
export function buildPayload({ url, title, visibleText, elements, captureId }) {
  const payload = {
    url: stripUrl(url),
    captureId,
  };
  const boundedTitle = truncate(title, EXTRACT_LIMITS.title);
  if (boundedTitle) payload.title = boundedTitle;
  const boundedText = truncate(visibleText, EXTRACT_LIMITS.visibleText);
  if (boundedText) payload.visibleText = boundedText;
  const boundedElements = boundElements(elements ?? []);
  if (boundedElements.length > 0) payload.elements = boundedElements;
  return payload;
}

/**
 * C4 safe-link policy — the extension's INDEPENDENT copy of the rules in
 * src/lib/computer/safe-link.ts. Server approval is necessary but not
 * sufficient: the extension re-checks every rule immediately before
 * navigating, so a compromised or buggy server cannot talk this extension
 * into an unsafe navigation.
 *
 * Safe = real anchor, https (or loopback http), same-origin as the current
 * page, no new tab, no download, no javascript:/data:/blob:/etc., not a
 * bare fragment.
 */

const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"];

export function isSafeNavigationTarget(href, pageUrl, options = {}) {
  const raw = String(href ?? "").trim();
  if (!raw) return false;
  if (options.download) return false;
  const target = String(options.target ?? "").trim().toLowerCase();
  if (target && target !== "_self") return false;
  if (raw.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const scheme = raw.slice(0, raw.indexOf(":")).toLowerCase();
    if (scheme !== "https" && scheme !== "http") return false;
  }
  let page;
  let resolved;
  try {
    page = new URL(pageUrl);
    resolved = new URL(raw, page);
  } catch {
    return false;
  }
  if (resolved.username || resolved.password) return false;
  if (resolved.protocol !== "https:") {
    if (!(resolved.protocol === "http:" && LOOPBACK.includes(resolved.hostname))) {
      return false;
    }
  }
  if (resolved.origin !== page.origin) return false;
  if (
    resolved.hash &&
    `${resolved.origin}${resolved.pathname}${resolved.search}` ===
      `${page.origin}${page.pathname}${page.search}`
  ) {
    return false;
  }
  return true;
}

/** Normalize a URL to the comparable document form (fragment dropped). */
export function documentUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

/**
 * Decide whether a claimed navigation command may be executed against the
 * live page. ALL of these must hold independently of what the server said.
 */
export function mayExecuteNavigation(command, live) {
  if (!command || !live) return false;
  // The tab must still be on the page the observation came from.
  if (command.observedUrl && documentUrl(live.pageUrl) !== documentUrl(command.observedUrl)) {
    return false;
  }
  // The element must still be present, still an anchor, still safe.
  if (!live.foundHref) return false;
  if (!isSafeNavigationTarget(live.foundHref, live.pageUrl, live)) return false;
  // And it must still point exactly where the human approved.
  if (documentUrl(new URL(live.foundHref, live.pageUrl).href) !== documentUrl(command.expectedHref)) {
    return false;
  }
  try {
    if (new URL(command.expectedHref).origin !== command.expectedOrigin) return false;
  } catch {
    return false;
  }
  return true;
}
