import { buildPayload } from "./extract-core.js";

/**
 * Operanto Computer Bridge popup (C2, read-only).
 *
 * Flow: the user pastes a session-bound pairing token minted in Operanto,
 * then clicks "Share this tab". That click is the explicit user gesture —
 * `activeTab` grants access to THIS tab, this once; there is no background
 * capture, no tab enumeration, no history access. The injected function
 * below only READS the page (roles, accessible names, visible text) and
 * never touches values, cookies, or storage. The server re-validates
 * everything; this extension is hygiene, not the security boundary.
 */

const statusEl = document.getElementById("status");
const apiBaseEl = document.getElementById("apiBase");
const tokenEl = document.getElementById("token");

chrome.storage.session.get(["apiBase"]).then(({ apiBase }) => {
  if (apiBase) apiBaseEl.value = apiBase;
});

function report(text) {
  statusEl.textContent = text;
}

/**
 * Injected into the shared tab. MUST stay self-contained (it is serialized
 * into the page) — it mirrors extension/computer-bridge/extract-core.js,
 * which is the unit-tested reference for this logic.
 */
function extractPageSemantics() {
  const LIMITS = { name: 300, role: 60, elements: 200, visibleText: 4000 };
  const clean = (value, max) => {
    const t = String(value ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) : t;
  };
  const nameOf = (el) => {
    const label =
      el.labels && el.labels.length > 0 ? el.labels[0].textContent : "";
    const candidates = [
      el.getAttribute && el.getAttribute("aria-label"),
      label,
      el.tagName === "INPUT" || el.tagName === "SELECT" ? "" : el.textContent,
      el.getAttribute && el.getAttribute("placeholder"),
      el.getAttribute && el.getAttribute("alt"),
      el.getAttribute && el.getAttribute("title"),
    ];
    for (const candidate of candidates) {
      const name = clean(candidate, LIMITS.name);
      if (name) return name;
    }
    return "";
  };
  const elements = [];
  const nodes = document.querySelectorAll(
    "h1,h2,h3,h4,h5,h6,a[href],button,input,select,textarea,[role]",
  );
  for (const el of nodes) {
    if (elements.length >= LIMITS.elements) break;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (rect && rect.width === 0 && rect.height === 0) continue;
    const tag = el.tagName.toLowerCase();
    const typeAttr = (el.getAttribute("type") || "").toLowerCase();
    if (typeAttr === "password" || typeAttr === "hidden") continue;
    let role = (el.getAttribute("role") || "").toLowerCase();
    if (!role) {
      if (tag === "a") role = "link";
      else if (tag === "button" || typeAttr === "submit" || typeAttr === "button")
        role = "button";
      else if (tag === "select") role = "combobox";
      else if (tag === "textarea" || tag === "input") role = "textbox";
      else if (/^h[1-6]$/.test(tag)) role = "heading";
      else continue;
    }
    const name = nameOf(el);
    if (!name && role !== "textbox" && role !== "combobox") continue;
    elements.push({ role: clean(role, LIMITS.role), name });
  }
  return {
    url: window.location.href,
    title: document.title,
    visibleText: clean(document.body ? document.body.innerText : "", LIMITS.visibleText),
    elements,
  };
}

async function apiCall(path, body) {
  const apiBase = apiBaseEl.value.trim().replace(/\/+$/, "");
  const token = tokenEl.value.trim();
  if (!apiBase || !token) throw new Error("API base and pairing token are required");
  await chrome.storage.session.set({ apiBase });
  const response = await fetch(`${apiBase}/api/computer/bridge/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

document.getElementById("capture").addEventListener("click", async () => {
  try {
    report("Attaching…");
    // Attach is idempotent-ish: an already-attached token just fails the
    // PENDING claim, which is fine — capture proceeds on ATTACHED.
    await apiCall("attach").catch(() => {});
    report("Reading this tab…");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageSemantics,
    });
    const payload = buildPayload({
      ...result,
      captureId: crypto.randomUUID(),
    });
    report("Uploading snapshot…");
    const stored = await apiCall("snapshot", payload);
    report(
      `Snapshot recorded (${stored.duplicate ? "duplicate" : "new"}): ${stored.snapshotId}`,
    );
  } catch (error) {
    report(`Failed: ${error.message}`);
  }
});

document.getElementById("detach").addEventListener("click", async () => {
  try {
    await apiCall("detach");
    report("Detached — observation stopped.");
  } catch (error) {
    report(`Failed: ${error.message}`);
  }
});
