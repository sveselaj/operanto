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
