# Operanto Computer C4.1 pilot — evidence collection

Status: **prepared 2026-08-07; evidence not yet collected.** This is an
operational validation phase, not a development slice. Nothing here adds
Computer capability. C5 is not authorized.

The pilot answers one question with evidence: *is the C4 primitive
reliable and useful in real work?* Method notes in
`docs/operanto-computer-c4-1.md`; this document is the runbook and the
case pack.

> **Who can run this.** Every case requires an authorized human: logging
> into the target application, sharing a tab from their own browser,
> reading the recommendation, and approving or rejecting it. That is the
> design — approval is deliberately not automatable, and driving the
> extension programmatically would be exactly the autonomous execution
> C4 forbids. An engineering agent can prepare, verify and report; it
> cannot generate this evidence.

## 1. Pilot environment (isolated, not shared staging)

Computer navigation must **not** be enabled on ordinary shared staging and
never in production. Use a dedicated preview/pilot deployment plus a pilot
organisation — no new infrastructure architecture.

**Deployment (Vercel preview, performed by the product owner):**

1. Create a preview deployment from `main` (a pilot branch is fine) with
   its own database branch — never the shared staging database.
2. Set on that deployment only:
   ```
   OPERANTO_COMPUTER_BRIDGE_ENABLED=1
   OPERANTO_COMPUTER_GUIDE_ENABLED=1
   OPERANTO_COMPUTER_NAVIGATION_ENABLED=1
   OPERANTO_COMPUTER_VALIDATION_CAMPAIGN=c41-pilot-01
   ```
3. Leave **live** Computer AI off unless the C3 eval gate is satisfied —
   `OPERANTO_COMPUTER_LIVE_ENABLED=1` **and**
   `OPERANTO_COMPUTER_LIVE_EVAL_VERSION` pinned to the code's current
   `COMPUTER_LIVE_EVAL_VERSION`, after rerunning the live injection
   fixtures. The deterministic mock provider is sufficient for most cases
   and is the safe default. **Do not weaken or bypass that gate.**
4. Confirm the three shared environments are untouched: production and
   staging must still have every `OPERANTO_COMPUTER_*` variable unset.

**Pilot organisation:** create a dedicated organisation (e.g.
`c41-pilot`) with one ADMIN membership for the pilot operator. Do not run
pilot cases inside a customer organisation, and do not link pilot sessions
to real customer records except in the contextual cases, which use
seeded fictional customers.

**Extension:** load `extension/computer-bridge/` unpacked, and point its
API base at the pilot deployment — never at production.

## 2. Per-case protocol

1. Create a Computer session with the case's trusted goal.
2. Mint a pairing token; attach the tab you intend to share.
3. Log into the target application **yourself**. Navigate to the starting
   page manually.
4. Share the tab (capture a snapshot).
5. Ask *“What am I looking at?”*, then *“Where should I look next?”*.
6. Decide honestly. **Reject freely** — disagreement is evidence, and a
   pilot with no rejections is a pilot that learned nothing.
7. If approved: issue the one-shot code, execute once, let the extension
   capture the post-navigation snapshot, let verification run. Then STOP.
8. Record the usefulness signal on the session page
   (*useful / not useful / wrong recommendation*).
9. Fill in the case record (§4) with **generic** notes only.
10. Run the report and confirm invariants are still zero:
    ```
    pnpm computer:validation-report --org c41-pilot --campaign c41-pilot-01
    ```

**When something fails, record the failure first.** Do not modify C4 to
make a site easier, and do not code around real-world inconveniences
during the pilot — those observations are the product of this phase. Fix
only what blocks security or pilot continuation, and say so explicitly.

## 3. First series — 10 supervised cases

Categories per `docs/operanto-computer-c4-1.md`. Cases 8–10 are the
**contextual** ones: they must exercise conversation/customer/task context
→ snapshot → C3 understanding → recommendation → approval → one
navigation → verification, not merely "open the obvious link".

| # | Category | Case | Contextual? |
|---|---|---|---|
| 1 | A — owned | FictionBank reference flow (local fixture) | no |
| 2 | A — owned | Operanto itself (cockpit navigation) | no |
| 3 | B — dev SaaS | GitHub: repository → Pull requests | no |
| 4 | B — dev SaaS | GitHub: second workflow (issues → a labelled view) | no |
| 5 | B — dev SaaS | Vercel: project → Deployments | no |
| 6 | B — dev SaaS | Vercel: second workflow (project → Settings overview, read-only) | no |
| 7 | C — commerce/ops | Logistics/tracking portal: shipment list → tracking detail | no |
| 8 | D — customer ops | CRM/customer-history workflow driven by a customer question | **yes** |
| 9 | E — financial (read-only) | Supervised financial UI: deposit page → Orders/history | **yes** |
| 10 | D+E — full contextual | End-to-end Operanto scenario (below) | **yes** |

**Case 9 hard limits — read-only navigation only.** Never transfer,
withdraw, trade, submit a financial instruction, change account or
security configuration, create credentials, or touch 2FA. The only
permitted effect is opening a read-only history/orders view. If a case
cannot be completed without any of the forbidden acts, abandon the case
and record it as abandoned.

### Case detail sketches

Full records use the §4 format. Sketches (fictionalized):

- **Case 1 — FictionBank.** Goal: “Find out what happened to my €200
  SWIFT transfer sent on 28 July.” Start: deposit page. Expected
  recommendation: the `Orders` link. Expected verification: VERIFIED.
  This is the CI acceptance case run by hand end-to-end; it validates the
  pilot setup itself before any third-party site.
- **Case 2 — Operanto.** Goal: “Show me the tasks raised from this
  conversation.” Start: a conversation page. Tests our own SPA behaviour
  and same-origin routing.
- **Cases 3–6 — GitHub / Vercel.** Client-side routing, re-render timing,
  and links whose accessible names repeat across a page (a natural source
  of `AMBIGUOUS_TARGET`).
- **Case 7 — logistics.** List → detail navigation; expect
  query-bearing detail links, which C4 rejects by design. Record how
  often that blocks a genuinely useful navigation — this is the single
  most important limitation to quantify.
- **Case 8 — CRM contextual.** A customer asks a question in a
  conversation; Operanto's context (customer, order, prior issue) should
  drive a recommendation the operator had not already decided on.
- **Case 9 — financial contextual, read-only.** “Where is my €200
  transfer?” → deposit page shared → Operanto reasons over the trusted
  goal and the observed page → recommends the history view → human
  approves → one navigation → verification.
- **Case 10 — full scenario.** Conversation + customer + task + snapshot
  + understanding + navigation + verification, recorded end-to-end.

## 4. Case record format

```text
Case ID:                  c41-01
Application/category:     A — owned / FictionBank fixture
Trusted goal:             (as entered, fictionalized if sensitive)
Starting page:            (generic description, e.g. "deposit page")
Expected recommendation:  (generic)
Expected safe target:     (element role + generic name)
Expected approval:        approve | reject
Expected destination:     (generic, e.g. "orders/history view")
Expected verification:    VERIFIED | INCONCLUSIVE | FAILED
Observed result:          (generic)
Human correction needed:  yes/no + what kind
Failure category:         (closed taxonomy, or none)
Usefulness:               USEFUL | NOT_USEFUL | WRONG_RECOMMENDATION
Notes:                    (generic; no URLs, page text or customer data)
```

**Never** paste real URLs, query strings, page text, element labels,
customer names or account data into this repository. Describe generically:
“list page with repeated ‘View’ links”, not the real link text.

## 5. Checkpoint 1 report template

Produced after ~10 meaningful cases, then **STOP** — do not continue to
30–50 and do not implement C5 without a new authorization.

```text
C4.1 PILOT CHECKPOINT 1

Cases attempted / completed / abandoned:
Recommendations made:
Bound-target rate:
Approvals / rejections:
Executions attempted:
VERIFIED / INCONCLUSIVE / FAILED:
Refusal taxonomy counts:
Usefulness: USEFUL / NOT_USEFUL / WRONG_RECOMMENDATION:
Contextual vs mechanical split:
Stale / ambiguous / changed-target observations:
Invariant status (must be 0/0/0/0):
Sensitive-leak confirmation:
UX observations:
Engineering issues discovered (reported, not fixed):
```

The structured half comes straight from
`pnpm computer:validation-report --org c41-pilot --campaign c41-pilot-01`;
the narrative half comes from the case records.

## 6. Expected friction (predictions to test, not excuses)

Recording these in advance so the pilot can confirm or refute them rather
than rationalize afterwards:

1. **Query-bearing links will block real navigations.** Detail pages are
   commonly `?id=…`. C4 rejects those by design (privacy). Expect this to
   be the top blocker in categories B, C and E. Quantify it.
2. **SPA re-render will invalidate refs.** Client-routed apps re-render
   between capture and execution; the ephemeral ref may vanish and the
   name fallback may be ambiguous. Expect `TARGET_CHANGED` /
   `AMBIGUOUS_TARGET`.
3. **The 10-minute snapshot freshness window may be too generous or too
   tight** once a human reads guidance and decides.
4. **Repeated accessible names** (“View”, “Details”, “Open”) will produce
   ambiguity refusals — correct behaviour, possibly poor UX.
5. **Two-step credential UX** (pairing token, then execution code) may
   prove clumsy in practice; note the friction, do not fix it mid-pilot.

## 7. What is deliberately NOT done in the pilot

No C5, no multi-step execution, no loops, no automatic second navigation,
no buttons/typing/submission/uploads/downloads, no cross-origin or
query/fragment destinations, no new-window navigation, no arbitrary
selectors, no Playwright/CDP automation of the bridge, no autonomous
approval, no production activation, and no third-party credentials in any
automated test.
