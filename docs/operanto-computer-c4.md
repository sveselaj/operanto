# Operanto Computer C4 — safe single navigation

Status: **delivered 2026-08-07, flag-gated OFF by default**
(`OPERANTO_COMPUTER_NAVIGATION_ENABLED=1`, which requires the C2 bridge and
C3 guide flags). C4 is the first Operanto → browser side effect, and it is
deliberately the smallest one that can exist: **one approved same-origin
anchor navigation per fresh observation, then STOP**. It is not
`computer.click()`, not autonomous navigation, and not a loop. Prior
slices: `docs/operanto-computer-c1.md` (domain), `-c2.md` (observation),
`-c3.md` (understanding); decision record:
`docs/operanto-computer-capability.md`.

## The protocol

```text
fresh snapshot (bridge-captured, ≤10 min old, tab still attached)
  → deterministic binding to ONE safe link in that snapshot
  → ComputerAction OPEN_SAFE_LINK (R1_NAVIGATE, APPROVAL_PENDING)
  → ApprovalRequest (unified gate, COMPUTER_ACTION, short expiry)
  → human approves  →  one-shot execution nonce (2 min, single use)
  → extension claims (APPROVED → EXECUTING, atomic)
  → extension INDEPENDENTLY revalidates the live page and element
  → chrome.tabs.update — exactly one navigation
  → fresh post-navigation snapshot
  → SERVER-side deterministic verification (origin + path)
  → audit  →  STOP
```

A second navigation requires a new observation and a new approval. Nothing
in the code can chain steps: the executed action is terminal, and its
credential cannot be reissued.

## What may ever be navigated

`src/lib/computer/safe-link.ts` is the single definition, enforced at
capture, proposal, claim — and independently in the extension. A target
must be a real anchor that is: https (or loopback http for local dev),
**same-origin** with the observed page, not `target=_blank`/named, not a
download, not `javascript:`/`data:`/`blob:`/`file:`/`mailto:`/`tel:`, not
a bare fragment, and free of embedded credentials. Buttons, JS-driven
elements, form submits, arbitrary selectors and model-supplied URLs are
**not representable** — there is no field or endpoint that accepts them.

## Execution identity (freshness)

C3's `{role,name}` is insufficient as an execution identity, and fragile
CSS/XPath selectors are never trusted targets. Instead each capture mints
**snapshot-scoped ephemeral refs** (`ComputerSnapshot.safeLinksJson`:
`{ref, role:"link", name, href}` where the server re-resolved and verified
every href). An action binds to: the exact snapshot, the exact ephemeral
ref, `expectedHref` + `expectedOrigin`, the exact session and bridge (tab),
and a one-shot nonce hash. Immediately before navigating, the extension
re-locates the element by ref (falling back to a *unique* accessible name —
ambiguity fails closed), re-checks the safe-link policy, confirms the tab
is still on the observed page, and confirms the href still equals what the
human approved. Anything stale, re-rendered or ambiguous refuses and asks
for a fresh capture.

## Approval

Reuses `ApprovalRequest` with `sourceType: COMPUTER_ACTION` — no second
approval mechanism. Although navigation is R1, **all** C4 execution is
approval-gated because this is the first execution slice. The payload
describes exactly what will happen (link name, expected href/origin,
reason) without page content; approvals carry a short `expiresAt`, and an
approval cannot be replayed for another snapshot, element or action
(idempotency key = action id, uniqueness on `(org, sourceType, sourceId)`).

## Action channel (threat-modelled separately from C2)

`POST /api/computer/bridge/navigate` with two ops, `claim` and `report`.
It requires the bridge bearer token **and** the one-shot nonce; it is
tenant-, session-, tab- and action-bound; the nonce is single-use with a
2-minute TTL; the claim transition is atomic; it is revoked on detach or
session close; and it never accepts a URL, selector or JavaScript from
anyone — the command is derived server-side from the bound action. **Server
approval is necessary but not sufficient**: the extension re-enforces every
rule itself (unit-tested, including a command whose href and origin
disagree — a compromised-server scenario).

## Verification (never self-reported)

After navigation the extension captures a new snapshot and reports; the
server computes the verdict from that snapshot: same origin **and** same
path → `VERIFIED`; same origin, different page → `INCONCLUSIVE`; origin
discontinuity → `FAILED` (and the action is `EXECUTION_FAILED`); no
post-navigation observation → `INCONCLUSIVE`. Before/after snapshots are
linked to the action. The model never marks its own action verified — it
cannot even reach this path.

## Audit

Ids/enums only: `computer.navigation.proposed`, `.credential_issued`,
`.claimed`, `.executed`, `.failed` — carrying action/session/snapshot/
bridge ids, the expected **origin** as operational metadata, and the
verification enum. Never the href, link name, page text, or the nonce
(tested).

## Acceptance + adversarial matrix (CI, FictionBank only)

Acceptance: goal "Find my €200 transfer" → deposit page with exactly one
safe `Orders` link → propose → approve → nonce → claim → navigate →
post-navigation capture → **VERIFIED**, with `proposed/approved/executed/
verified` recorded and exactly one action in the session.

All of these fail closed (integration-tested): stale snapshot, duplicate
target, target changed after approval, cross-origin href, `javascript:`
href, download link, `target=_blank`, hostile page instructions, replayed
nonce, expired execution credential, expired approval, wrong tenant, wrong
session, detached tab, changed origin after navigation, unapproved action,
rejected action, and OPERATOR without `computer:operate`.

## Flags, permissions, migrations

Flag `OPERANTO_COMPUTER_NAVIGATION_ENABLED` (off; requires bridge + guide).
Permissions unchanged: `computer:operate` proposes and mints credentials,
`approvals:decide` decides — no new permission was invented. Two additive
migrations: `20260807180710_computer_c4_enums` (`OPEN_SAFE_LINK`;
`EXECUTING`/`EXECUTED`/`EXECUTION_FAILED`) and
`20260807180712_computer_c4_safe_navigation` (`ComputerSnapshot.safeLinksJson`;
`ComputerAction` target/nonce/execution columns + unique nonce hash).
Applied locally through the db-guard; staging untouched this slice.

## Explicitly not in C4

Bounded autonomous step loops, multi-step navigation, buttons/menus,
typing, form submission, uploads/downloads, screenshots, Playwright/CDP,
any model-issued browser command. Those belong to a later slice with its
own security review.
