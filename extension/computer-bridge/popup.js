import { buildPayload, mayExecuteNavigation } from "./extract-core.js";

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
  const links = [];
  let linkSeq = 0;
  const nodes = document.querySelectorAll(
    "h1,h2,h3,h4,h5,h6,a[href],button,input,select,textarea,[role]",
  );
  for (const el of nodes) {
    // C4: collect anchor candidates with a snapshot-scoped ephemeral ref.
    // The SERVER re-classifies each one; unsafe ones are dropped there.
    if (el.tagName === "A" && el.getAttribute("href") && links.length < 50) {
      const linkName = nameOf(el);
      if (linkName) {
        const ref = `l${linkSeq++}`;
        el.setAttribute("data-operanto-ref", ref);
        links.push({
          ref,
          name: linkName,
          href: el.getAttribute("href"),
          target: el.getAttribute("target"),
          download: el.hasAttribute("download"),
        });
      }
    }
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
    links,
  };
}

/**
 * C4: re-locate the approved anchor in the LIVE page and report what it
 * currently is. Reads only — it never navigates. The decision to navigate
 * is taken in the popup via mayExecuteNavigation(), and the navigation
 * itself is performed by the extension (chrome.tabs.update), never by
 * injected script clicking arbitrary elements.
 */
function inspectNavigationTarget(targetRef, linkName) {
  const byRef = document.querySelector(`a[data-operanto-ref="${targetRef}"]`);
  let anchor = byRef;
  if (!anchor) {
    const named = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const label = (a.getAttribute("aria-label") || a.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return label === linkName;
    });
    // Ambiguity fails closed: never guess which "Orders" the human meant.
    if (named.length !== 1) return { pageUrl: window.location.href, foundHref: null };
    anchor = named[0];
  }
  return {
    pageUrl: window.location.href,
    foundHref: anchor.getAttribute("href"),
    target: anchor.getAttribute("target"),
    download: anchor.hasAttribute("download"),
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

/**
 * C4: execute ONE approved navigation. The operator pastes the one-shot
 * nonce they received after approving in Operanto. The extension claims the
 * command, INDEPENDENTLY revalidates it against the live page, navigates
 * exactly once via chrome.tabs.update (no injected clicking, no arbitrary
 * URL from the model), captures a fresh snapshot, and reports the outcome —
 * the server decides whether it verified. Then it stops.
 */
document.getElementById("navigate").addEventListener("click", async () => {
  const nonce = document.getElementById("nonce").value.trim();
  if (!nonce) return report("Paste the one-shot execution code from Operanto.");
  let command;
  try {
    report("Claiming execution credential…");
    ({ command } = await apiCall("navigate", { op: "claim", nonce }));
  } catch (error) {
    return report(`Refused: ${error.message}`);
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: live }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectNavigationTarget,
      args: [command.targetRef, command.linkName],
    });
    // Independent enforcement — the server's approval is not sufficient.
    if (!mayExecuteNavigation(command, live)) {
      await apiCall("navigate", {
        op: "report",
        actionId: command.actionId,
        ok: false,
        error: "extension_revalidation_failed",
      });
      return report(
        "Refused: the page or the link changed since it was observed. Capture again.",
      );
    }
    report("Navigating once…");
    await chrome.tabs.update(tab.id, { url: command.expectedHref });
    // Fresh post-navigation observation, so the server can verify.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const [{ result: after }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageSemantics,
    });
    await apiCall(
      "snapshot",
      buildPayload({ ...after, captureId: crypto.randomUUID() }),
    );
    const outcome = await apiCall("navigate", {
      op: "report",
      actionId: command.actionId,
      ok: true,
    });
    report(`Navigation ${outcome.status} · verification ${outcome.verification}`);
  } catch (error) {
    await apiCall("navigate", {
      op: "report",
      actionId: command.actionId,
      ok: false,
      error: "execution_error",
    }).catch(() => {});
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
