# Operanto Computer Bridge (C2 — read-only)

Chrome Manifest V3 extension that lets an explicitly authorized user share
the **current tab** with an Operanto ComputerSession as a sanitized,
bounded, semantic snapshot. Part of Operanto Computer
(`docs/operanto-computer-capability.md`, `docs/operanto-computer-c2.md`) —
not a standalone product.

**Observation is one-way.** The extension has no code path that clicks,
types, navigates, submits, downloads, or uploads. It never reads form
values, password/hidden fields, cookies, localStorage/sessionStorage, or
headers of the target site. URLs are stripped to origin + pathname before
leaving the browser. The Operanto server re-validates every payload with a
strict schema (`src/lib/computer/browser-payload.ts`) — the extension is
hygiene, not the security boundary.

Trust model:

- The user authenticates to the target site themselves; Operanto never
  sees those credentials.
- Pairing uses a short-lived, tenant- and session-bound token minted in
  Operanto (`createComputerBridgeGrant`) — SHA-256 at rest, hard expiry,
  revoked when the session closes or either side detaches.
- Capture requires a toolbar-click gesture (`activeTab`): no background
  tabs, no history, no continuous capture.

Local use (server flag `OPERANTO_COMPUTER_BRIDGE_ENABLED=1` required):

1. `chrome://extensions` → Developer mode → *Load unpacked* → this folder.
2. Mint a pairing token for a ComputerSession in Operanto.
3. Open the page you want to share, click the extension icon, paste the
   token, press **Share this tab**.

`extract-core.js` is the unit-tested pure extraction logic
(`test/bridge-extract-core.test.ts`); the function injected by `popup.js`
mirrors it and must be kept in sync.
