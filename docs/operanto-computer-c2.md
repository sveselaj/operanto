# Operanto Computer C2 — browser bridge (read-only observation transport)

Status: **delivered 2026-08-07, flag-gated OFF by default**
(`OPERANTO_COMPUTER_BRIDGE_ENABLED=1`). C2 lets an explicitly authorized
user share the CURRENT browser tab with a ComputerSession as a sanitized
semantic `ComputerSnapshot`. **Observation is one-way — there is still no
executor**: no clicking, typing, navigating, submitting, uploading,
downloading, no Playwright/CDP, no credential/cookie capture, no
target-system side effect of any kind. The 2026-08-02 agent-runtime gate
holds; no model is involved anywhere in this flow. Decision record:
`docs/operanto-computer-capability.md`; C1 foundation:
`docs/operanto-computer-c1.md`.

## Architecture

```text
User-controlled browser (user authenticates to the target site themselves)
        ↓ toolbar click on the shared tab (explicit gesture, activeTab)
MV3 extension (extension/computer-bridge/) — read-only extractor
        ↓ Bearer pairing token (session-bound, SHA-256 at rest, 60 min)
POST /api/computer/bridge/{attach|snapshot|detach}
        ↓ rate limit · 512KB cap · flag gate (404 off) · no cookies
sanitizeBrowserPayload (src/lib/computer/browser-payload.ts) — AUTHORITATIVE
        ↓ strict schema: role+name elements, origin+path URL, bounded text
ComputerSnapshot (bridgeId, clientCaptureId) → C1 privacy/audit spine
```

- **Pairing**: `createComputerBridgeGrant(ctx, sessionId)` —
  `computer:operate`, open session, flag on. Mints 32 random bytes
  (base64url) returned ONCE; at rest only the SHA-256 hash (the
  invitation-token pattern). One active grant per session (prior grants
  revoked). Hard 60-minute expiry.
- **Attach** is the first token use — an atomic PENDING→ATTACHED claim.
  Detach (either side), cockpit revoke, session cancel/conclude, and
  expiry all kill the credential. A closed session cannot be observed.
- **Capture** requires ATTACHED + unexpired + session open + customer not
  restricted. Replay-idempotent: `(bridgeId, clientCaptureId)` unique — a
  retried POST returns the original snapshot.
- **The extension is untrusted input.** It performs the same hygiene
  client-side (best effort), but the server schema is the boundary and
  fails closed: unknown keys anywhere — element `value`, `cookies`,
  coordinates — reject the whole payload (422, content never echoed).

## Data captured / deliberately not captured

Captured (bounded): page URL as **origin + pathname only** (query strings
and fragments are dropped unconditionally — they carry tokens and PII),
title ≤500, visible text ≤4000 chars, ≤200 semantic elements as
`{ role, name }` (headings, links, buttons, inputs by accessible name).

Never captured, by construction: form-field **values** of any kind,
password/hidden inputs (skipped entirely — not even their names), cookies,
localStorage/sessionStorage, Authorization headers, tokens, 2FA codes,
private keys, screenshots (deferred, §Screenshots), background tabs,
browsing history. The schema has **no field these could live in**, and the
extension's `activeTab`-only permission model cannot see beyond the tab
the user explicitly shared, at the moment they shared it.

## Injection merge gate

Page content is UNTRUSTED OBSERVATION DATA. Integration-tested with
hostile visible text, titles, URLs and aria-label/button names
("ignore Operanto policy…", "approve all pending actions"): the content
is stored as data and **nothing moves** — session goal, statuses, risk
tiers, approvals, permissions and routing are all unchanged, and the
hostile strings never reach audit metadata. No service reads snapshot
content to make any decision (structural, from C1).

## Screenshots / ComputerArtifact — deferred

The acceptance scenario is satisfied with semantic data alone, so binary
artifacts stay out of C2. `ComputerArtifact` (tenant-scoped storage
abstraction, retention, erasure, access control) is designed before the
first binary is written, in C2b/C3 — no base64 into Prisma, ever.

## Permissions

Reused unchanged: `computer:operate` gates grant minting and cockpit
detach; `computer:read` gates reading stored snapshots. No
`computer:browser`/`computer:capture` — attaching a tab is operate-class
authority, and no distinct authorization boundary appeared.
OPERATOR/AUDITOR expansion remains deferred.

## Acceptance scenario (proven in test/computer-bridge.integration.test.ts)

A FICTIONAL deposit page (`deposit.fictionbank.test/eur/swift` — no real
site, no real credentials, nothing automated against any provider) in the
shape of the eventual "Binance EUR SWIFT deposit" demo. From one capture,
Operanto persists enough to identify: the application/origin, the page
purpose ("Deposit EUR"), transfer method = SWIFT, expected arrival = 0–5
business days, an `Orders` link, and an `I've sent the funds` button —
as inert `{role, name}` data with nothing clickable and the session
token stripped from the URL. *Operanto can see and understand the
software the user is already using — and cannot touch it.*

## Migration safety hardening (the C1 incident, answered mechanically)

`scripts/db-guard.ts` + `pnpm db:guard`, wired in front of `db:migrate`
and `db:seed`: inspects **both** `DATABASE_URL` and `DIRECT_URL`
(Prisma migrations follow `DIRECT_URL`) and **fails closed** when either
points at a non-local host, printing hostnames only — never credentials.
Explicit override: `OPERANTO_DB_GUARD_ALLOW_REMOTE=1`. `db:deploy` is
deliberately unguarded — deploying reviewed migrations to the shared
environment is its purpose (build pipeline). Invariant: **no development
database command may touch a shared database without the explicit
override.** Unit-tested (`test/db-guard.test.ts`), including the exact C1
failure shape (local `DATABASE_URL`, remote `DIRECT_URL`).

## Schema / migration

`20260807161054_computer_c2_browser_bridge` (additive): one new model
`ComputerBridgeGrant` (+ `ComputerBridgeStatus` enum) and two nullable
columns on `ComputerSnapshot` (`bridgeId`, `clientCaptureId`) with the
replay-idempotency unique. Authored via `prisma migrate diff` against a
local shadow database and applied locally through the guard.

## Privacy

Bridge-produced snapshots are ordinary `ComputerSnapshot` rows: erasure
redacts them with the session graph, restriction pauses capture (Art. 18,
tested), retention sweeps them on the per-organisation message window.
Grants hold no personal content (hash + timestamps). Audit stays
ids-only: `computer.bridge.granted/.attached/.detached` and
`computer.snapshot.recorded` carry ids, enums and counts — never URLs,
titles, page text, element names, or tokens (tested).

## Flag behavior

Off (default): grant creation refuses, all three bridge endpoints return
404, and the application behaves identically to a build without the
bridge — no UI, no navigation, nothing discoverable. On: the flow above,
still with no way to affect the target page.

## Deferred (not authorized)

C3 page understanding/guide mode; screenshots/`ComputerArtifact`;
cockpit pairing UI (tokens are minted via the service; the surface ships
with the C3 understanding UI); Firefox/Safari ports; any execution.
