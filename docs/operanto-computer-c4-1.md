# Operanto Computer C4.1 — controlled execution validation

Status: **delivered 2026-08-07. Zero schema migrations. No change to what
Computer is allowed to do.** C4.1 exists to make our *evidence* about the
C4 primitive stronger, not to make Operanto more powerful. The browser-side
effect surface is unchanged and remains exactly:

```text
OBSERVE → UNDERSTAND → RECOMMEND → HUMAN APPROVES
        → ONE SAFE NAVIGATION → VERIFY → STOP
```

Prior slices: `docs/operanto-computer-c1.md` … `-c4.md`; decision record
`docs/operanto-computer-capability.md`. **C5 is not authorized** and
nothing here unlocks it.

## What C4.1 adds (and deliberately does not)

| Added | Not added |
|---|---|
| Refusal audit events with a bounded enum reason | Any new action type or capability |
| A coarse human usefulness signal (enum, audit event) | Any new persistence/table/column |
| Derived metrics + CLI report + small internal view | Any third-party telemetry dependency |
| Campaign grouping via `AuditEvent.correlationId` | Any raw page content in telemetry |

**Zero migrations.** The C1–C4 model already carries the lifecycle data;
the only genuine gap was that *refusals* failed closed **silently** — a
replayed credential or cross-tenant claim attempt left no trace at all.
That was a security-observability gap as much as a validation one, and it
is fixed by auditing refusals with an enum reason (`computer.navigation.refused`).

## Metric derivation (no new storage)

| Metric | Derived from |
|---|---|
| recommendation_count | `AIAction` COMPUTER_GUIDE (COMPLETED/SUPERSEDED) |
| recommendation_with_bound_target_count | `outputJson.grounding.target === "BOUND"` |
| approval / rejection / cancellation counts | `ApprovalRequest` (`sourceType: COMPUTER_ACTION`) |
| action_claimed_count | `ComputerAction.executionClaimedAt` |
| extension_execution_count | `ComputerAction.executedAt` |
| verification_verified/inconclusive/failed | `ComputerAction.verificationResult` |
| stale / ambiguous / policy / replay / expiry / detached counts | `computer.navigation.refused` audit reasons |
| policy-dropped link candidates | `computer.snapshot.recorded` → `droppedLinkCount` (a count) |
| duration buckets | existing timestamps, bucketed coarsely |
| human_correction_required | `computer.validation.assessed` → `WRONG_RECOMMENDATION` |

Rates use defensible denominators: **approval agreement** is over *decided*
proposals (pending ones are not evidence), **verification rate** is over
*executed* navigations. With no data a rate reports `n/a` — C4.1 never
invents a percentage from `0/0`.

## Privacy

Validation data is ids, enums, booleans, counts and coarse duration
buckets. It contains **no** page text, titles, URLs, query strings,
fragments, element names, customer names, conversation content, session
goals, prompts, model responses, tokens, cookies, or screenshots. The one
URL-shaped value anywhere is `expectedOrigin` (e.g.
`https://deposit.fictionbank.test`) — an origin, never a path, query or
fragment, and already audited in C4. Integration-tested: a report built
over a session containing a secret-bearing goal, customer name and page
text contains none of it. Existing erasure/retention rules are untouched;
a redacted `AIAction` simply contributes no bound-target signal.

## Failure taxonomy (closed vocabulary)

`STALE_SNAPSHOT`, `AMBIGUOUS_TARGET`, `TARGET_NOT_FOUND`, `TARGET_CHANGED`,
`POLICY_REJECTED`, `APPROVAL_EXPIRED`, `ACTION_EXPIRED`, `BRIDGE_DETACHED`,
`ORIGIN_CHANGED`, `EXTENSION_REJECTED`, `NAVIGATION_FAILED`,
`VERIFICATION_INCONCLUSIVE`, `VERIFICATION_FAILED`, `USER_REJECTED`,
`USER_CANCELLED`, `WRONG_RECOMMENDATION`, `REPLAYED_CREDENTIAL`,
`WRONG_TENANT_OR_SESSION`, `NOT_ENABLED`.

Unrecognised values are ignored rather than becoming ad-hoc dimensions,
and **arbitrary exception messages are never used as analytics data**.

## Invariants — must all remain 0

Computed from domain state, never inferred from refusals (a *blocked*
attempt is the protection working, not a breach):

- **unauthorizedSideEffects** — any action type other than `OPEN_SAFE_LINK`
  reaching `EXECUTING`/`EXECUTED`.
- **crossOriginEscapes** — an executed action whose after-snapshot origin
  differs from `expectedOrigin`.
- **replaySuccesses** — an action that reached execution *without* a
  granted approval (the observable shape of a replay/bypass; two
  executions of one action is unrepresentable by construction).
- **sensitiveUrlPersistence** — any persisted `expectedHref` containing
  `?` or `#`.

The CLI exits non-zero on any breach.

## Validation campaigns

Set `OPERANTO_COMPUTER_VALIDATION_CAMPAIGN=<opaque-label>` on the
deployment running the pilot. Computer audit events are then stamped with
it via `AuditEvent.correlationId` (already indexed by
`(organisationId, correlationId)`), so intentional validation runs can be
separated from ordinary use with no schema change and no experiment
platform. The label is bounded and opaque (`[A-Za-z0-9_.:-]{1,64}`) and
grants no capability.

## Reporting surfaces

- **CLI (portable, primary):**
  `pnpm computer:validation-report --org <slug> [--since ISO] [--until ISO] [--campaign id]`
- **Internal view:** `/computer/validation` — under the existing `/computer`
  gate (navigation flag + `computer:read`), no new navigation entry, no new
  permission.

Both call the *same* derivation (`src/lib/computer/validation-query.ts`),
so no metric has two definitions. Nothing is SaaS-specific: the report runs
against ordinary Operanto state in Operanto Cloud, a private customer
cloud, a customer-managed deployment, or a future edge/hybrid shape.

## Application matrix

| Category | Targets | Notes |
|---|---|---|
| **A. Owned / controlled** | FictionBank fixture; Operanto itself | CI-safe; the only category exercised automatically |
| **B. Developer / SaaS dashboard** | GitHub, Vercel | SPA re-render and client-routing behaviour |
| **C. Commerce / operations** | Shopify-like admin, logistics/tracking portal | redirects, list→detail routes |
| **D. Customer operations** | CRM / customer-history workflow | the contextual cases (below) |
| **E. Supervised real financial UI** | Orders / deposit history, **read-only** | never transfer, withdraw, or submit anything |

**No third-party credentials are ever automated.** A real-site validation
means: the authorized user logs in manually, shares the current tab,
reviews the recommendation, and explicitly approves the single navigation.

## Validation case format

```text
Case ID:
Application/category:
Trusted goal:
Starting page:
Expected recommendation:
Expected safe target:
Expected approval behaviour:
Expected destination:
Expected verification:
Observed result:
Human correction required:
Failure category:        (closed taxonomy above)
Notes:
```

Repository fixtures use **fictionalized** content only; real-world case
notes are described generically (category + outcome + failure class),
never with real URLs, customer data or page text.

## Contextual cases matter most

"Operanto opened the obvious link the human was already looking at" is
technically correct and commercially weak. At least part of the sample
must exercise the *combined* architecture:

```text
Conversation ("Where is my package?")
  + Customer/Task context (who, which order, prior issue)
  + ComputerSnapshot (the carrier portal page)
  + C3 understanding (what this page shows)
  → recommendation the human had not already decided on
  → approval → one safe navigation → verification → STOP
```

Record these separately from "open Orders" cases; they are the evidence
that Operanto's context is doing work, not the extension.

## Pilot runbook

The operational runbook, the 10-case first series, the case record
format and the Checkpoint 1 template live in
`docs/operanto-computer-c41-pilot.md`. Summary of the per-case protocol:

## Pilot protocol

1. Enable on the pilot deployment: `OPERANTO_COMPUTER_BRIDGE_ENABLED=1`,
   `OPERANTO_COMPUTER_GUIDE_ENABLED=1`,
   `OPERANTO_COMPUTER_NAVIGATION_ENABLED=1`, and
   `OPERANTO_COMPUTER_VALIDATION_CAMPAIGN=<label>`. (Live AI additionally
   requires the C3 eval gate; mock is fine for most cases.)
2. Load the extension; create a session with a real trusted goal.
3. Log in to the target application **yourself**; share the tab.
4. Ask "What am I looking at?" / "Where should I look next?".
5. Approve or reject — reject freely; disagreement is data.
6. If approved: issue the one-shot code, execute once, let verification run.
7. Record the usefulness signal (`USEFUL` / `NOT_USEFUL` /
   `WRONG_RECOMMENDATION`) and fill in the case format.
8. Run the report; confirm invariants are still 0.

Target sample: roughly **30–50 approved navigations** with diversity across
categories A–E — enough to expose SPA re-rendering, stale snapshots,
semantic duplication, redirects, route changes, extension timing and
verification edge cases. This is an evaluation target, not a product rule,
and no code enforces it.

## C5 decision gate (review criteria, not code)

C4.1 produces evidence for a **human** decision. Nothing here unlocks
anything. The later review should weigh: ~30–50 meaningful approved
executions; ideally ≥95% VERIFIED for this narrow primitive, or a
well-understood explanation; **zero** unauthorized side effects, cross-origin
escapes, replay successes and sensitive query/fragment persistence; an
acceptable stale/changed-target rate; acceptable approval UX; and real
evidence that contextual recommendations saved work. Only the product
owner authorizes C5.
