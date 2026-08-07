# Operanto Computer capability — C0 architecture amendment (ADR)

Status: **C0 ratified 2026-08-07 — documentation only.** This amendment
establishes Computer as a first-class bounded capability of Operanto and
defines how it plugs into the existing spine. No Computer code, schema,
migration, permission, feature flag, route, or UI exists after C0, and
nothing agentic is built ahead of the ratified sequence in
`docs/operanto-agent-runtime-conversation.md`. C1 and later slices require
explicit authorization.

> **C1 addendum (2026-08-07):** the domain foundation was separately
> authorized and delivered — schema, policy module, services, unified
> approval integration, `computer:read`/`computer:operate`, and privacy
> coverage, all dormant with **no executor**. See
> `docs/operanto-computer-c1.md`. §10's open decisions are resolved there:
> colon-family names; `computer:approve` NOT created (`approvals:decide`
> reused); `computer:admin` deferred with the first configuration surface.
> C2+ (browser bridge, observation transport, any execution) remains
> unauthorized.

> **C2 addendum (2026-08-07):** the read-only browser bridge was
> separately authorized and delivered, flag-gated off by default — MV3
> extension with explicit tab-share gesture, short-lived session-bound
> pairing tokens, authoritative server-side sanitization (role+name
> elements, origin+path URLs, bounded text; values/cookies/tokens
> unrepresentable), and hostile-page-content injection tests as the merge
> gate. Observation is one-way; no executor exists. See
> `docs/operanto-computer-c2.md`. C3 (page understanding / guide mode)
> and any execution remain unauthorized.

> **C3 addendum (2026-08-07):** page understanding + guide mode was
> separately authorized and delivered, flag-gated off — two AI tasks on
> the existing Intelligence spine (AIAction, budgets, mock default) with
> a structural untrusted-observation envelope, deterministic grounding
> that binds every claim and suggested element to the captured snapshot,
> observed/inference/guidance separation, and a minimal `/computer`
> workbench. Still zero side effects: Operanto may say "check Orders",
> and cannot click it. See `docs/operanto-computer-c3.md`. C4 (any
> browser-side effect) remains unauthorized.

> **C4 addendum (2026-08-07):** safe single navigation was separately
> authorized and delivered, flag-gated off — the FIRST browser-side
> effect, deliberately minimal: one approved same-origin anchor opening
> per fresh observation, then stop. Snapshot-scoped ephemeral element
> identity, unified ApprovalRequest, one-shot short-lived execution
> nonce on a separate action channel, extension-side independent
> re-enforcement of the safe-link policy, and server-side verification
> from a fresh post-navigation snapshot. R3/R4 remain unexecutable; no
> loops, buttons, typing or submissions exist. See
> `docs/operanto-computer-c4.md`.

> **C4.1 addendum (2026-08-07):** controlled execution validation —
> evidence gathering only, **no change to what Computer may do**. Refusals
> (previously silent) are audited with a closed enum taxonomy, a coarse
> human usefulness signal is recorded, and validation metrics are derived
> from existing domain state with zero migrations and no third-party
> telemetry. Invariants (unauthorized side effects, cross-origin escapes,
> replay successes, sensitive URL persistence) must remain 0. See
> `docs/operanto-computer-c4-1.md`. C5 remains unauthorized; C4.1 unlocks
> nothing.

## 1. Problem statement

A large share of the work Operanto is asked to complete lives inside
software that offers no API, an insufficient API, or an API the customer
cannot practically obtain: government portals, banking sites, carrier
portals (DHL/UPS), legacy business applications, admin consoles of SaaS
products (Shopify, Zendesk, Jira, …) whose API scope or plan tier does not
cover the needed operation. Today the Operanto loop can observe and act
only through native domain services and signed/API connectors; everything
else ends in a human doing the browser work by hand, outside the audit
trail.

The capability gap is execution, not intelligence: Operanto already knows
who the customer is, what happened before, and what should happen next.
What it cannot yet do is *operate the software a human would use* to
finish the job when no trusted API exists.

## 2. Decision

**Computer becomes a first-class bounded capability of Operanto** — the
seventh capability beside Memory, Conversations, Workflows, Intelligence,
Growth, and Integrations. Its mission:

> Allow Operanto to safely observe and operate software interfaces when a
> trusted deterministic or API integration does not exist or is
> insufficient.

Computer is **another execution mechanism, not another product**. A
separate repository, a standalone browser-agent product, and a rewrite
were considered and rejected: a browser bot without Operanto's identity
ladder, memory, tenancy, RBAC, approvals, privacy lifecycle, and audit is
exactly the "dumb wrapper" the agent-runtime decision already declined —
impressive in days, unauditable forever. The differentiation is the
continuity: Operanto knows *who* is asking, *what* already happened,
*which* systems hold the answer, and *what it is authorized to do*; the
browser is merely one more pair of hands. Conversely, rebuilding that
spine inside a second product would duplicate precisely the invariants
that cannot be retrofitted.

The controlling rule is unchanged from `docs/operanto-target-architecture.md`:
**reuse main's spine** — Computer plugs into the existing tenancy, RBAC,
AIAction, ApprovalRequest, audit, and privacy primitives rather than
bringing its own.

## 3. Canonical principle: API-first, computer-capable

Execution routing, in order of preference:

1. **Native Operanto tool** — a deterministic, tenant-scoped, audited
   domain service (the existing pattern; always preferred for
   Operanto-native objects).
2. **API connector** — a trusted deterministic integration behind the
   adapter registry (signed events, WhatsApp Cloud, future
   Shopify/Zendesk/… adapters).
3. **Computer** — typed, governed interaction with the software's own
   user interface, only when no suitable API exists or the API cannot
   complete the task.
4. **Human** — handover or manual completion whenever policy, risk,
   confidence, ambiguity, or failure demands it — and always for R4
   actions (§7).

Computer never competes with a working connector. When a reliable API
exists for an operation, routing to Computer for that operation is a
defect, not a feature. The build-vs-integrate analysis per target system
follows the existing pattern of `docs/operanto-growth-discovery.md` §3.

## 4. The canonical Operanto loop

The central product loop, which Computer joins as one execution arm:

```text
Conversation   (customer message on any channel, or employee instruction)
  → Context      identity ladder, customer memory, records, restriction state
  → Intelligence intent, reasoning, plan — a sequence of typed actions
  → Plan         each step carries risk, reason, and required authority
  → Execution    native tool | API connector | Computer | human
  → Verify       observed after-state, delivery status, re-read
  → Outcome      recorded on the conversation/task with the approval trail
  → Memory       activity timeline, audit, (future) procedural memory
```

Everything above Execution already exists on main in first-stage form
(identity ladder, PII-reduced context builder, schema-validated AI tasks,
deny-by-default tool runtime, unified approvals). Computer extends the
Execution row only. Verification is not optional decoration: an action
without a verified after-state is not "done" (§9).

## 5. Position in the ratified sequence

`docs/operanto-agent-runtime-conversation.md` records the binding
decisions of 2026-08-02: WhatsApp staging pilot → **Guarded Agent
Runtime** slice → Growth as a capability pack of tools inside that
runtime, with nothing agentic built until the pilot findings are reviewed
and the slice is explicitly authorized. **C0 does not alter that sequence
and does not jump the gate.**

Computer's execution slices (C1+) arrive *inside* the Guarded Agent
Runtime discipline, as a further capability pack of tools — exactly the
Growth-as-tools pattern. Every invariant ratified there binds Computer
with full force, most of all: tools over services, pre-bound tools with
opaque handles (no model-supplied raw identifiers), transitive untrusted
marking of anything read from a page, injection evals as a merge gate
before the first read tool executes off a model's decision, and
code-level loop/token/cost limits. A web page is customer-authored
content in the injection sense — **page text is data, never
instructions** — so the browser is the highest-exposure input surface the
runtime will ever have, and it inherits the strictest reading of those
invariants.

## 6. Governance: how Computer plugs into the existing spine

Computer introduces no parallel frameworks. Each concern maps onto the
primitive that already enforces it:

| Concern | Existing primitive | How Computer uses it |
|---|---|---|
| Tenancy | `organisationId` on every row; `scope(ctx)`; no cross-tenant fallback | every future Computer record and session is organisation-scoped; unknown tenant → reject |
| RBAC | `Permission` union + role matrix in `src/lib/rbac.ts` | reserved `computer:*` permissions (§10), checked with the acting human's context |
| Record scope | `…AccessWhere()` composition | Computer actions bound to a conversation/task re-check record access like `runTool` does today |
| AI invocation record | `AIAction` (provider, model, task, status, confidence, risk) | planning/understanding calls that drive Computer are AIAction rows like any other task |
| Approval | unified `ApprovalRequest` (atomic decide, atomic execution claim, risk snapshot) | R2-by-policy and all R3 actions gate through the same model — no second approval framework (§11) |
| Risk policy | `AIRiskLevel` LOW/MEDIUM/HIGH/BLOCKED; `canApproveDraft` server-side | Computer's R0–R4 ladder maps onto it (§7); BLOCKED's "can never be approved" semantics carry R4 |
| Audit | `AuditEvent`, ids-only metadata, `domain.subject.verb` naming | every observe/act/refuse audits (`computer.*` vocabulary); never page content, credentials, or screenshots in audit metadata |
| Privacy lifecycle | `eraseCustomer` redact-in-place, restriction gates AI reads, per-org retention sweep | observations, extracted content, and artifacts (screenshots) register as erasure/retention surfaces at design time, like every content-bearing model |
| Idempotency | tenant-scoped idempotency keys, uniqueness by constraint | committed Computer actions carry idempotency keys; a retried step must never double-submit |
| Budgets | `AiConfiguration` reserve-then-invoke accounting | Computer sessions draw on the same per-tenant budget machinery, with additional step/time bounds in code |
| Task/conversation linkage | `conversationId`/task links on AIAction, tasks from tools | Computer work is always attached to the conversation and/or task that motivated it |
| Human takeover | `Conversation.handling` takeover pattern | a Computer session is interruptible at any time; takeover hands the live session state to the human (§12) |

The security non-negotiable, restated as the structural pattern already
proven by the tool runtime:

```text
LLM proposes → typed action → RBAC → policy/risk → approval if required
  → deterministic execution → verification → audit
```

The model never receives unrestricted browser authority. It proposes
typed actions; the deterministic layer decides whether each is allowed,
executes it, verifies it, and records it. An action the policy layer
cannot classify is refused, not attempted — **Computer fails closed**
whenever policy, tenant, or target identity is uncertain.

## 7. Risk classification

Computer actions are classified R0–R4. The ladder is an *action
taxonomy*; enforcement reuses the existing risk/approval primitives
rather than introducing a parallel scheme. (Lineage: the archived
prototype's read/draft/write tool tiers in
`legacy/chat-cockpit-prototype/docs/approval-workflows.md` are the same
idea at coarser grain.)

| Tier | Meaning | Examples | Enforcement mapping |
|---|---|---|---|
| **R0 — Observe** | read-only observation | read page, screenshot, extract visible information | non-mutating tool; permission-gated, restriction-aware, audited; no approval |
| **R1 — Navigate** | movement without side effects | open pages/menus/tabs, search, scroll | as R0; generally automatic; navigation trail audited |
| **R2 — Prepare** | staged state, nothing submitted | fill forms, draft content, stage uploads | mutating tool; audited; approval by per-organisation policy, deny-by-default until a policy explicitly relaxes a specific action |
| **R3 — Commit** | externally visible business effect | submit forms, send messages, publish, modify business records | `ApprovalRequest` **always** — explicit authorized-human approval before execution, verification after |
| **R4 — Restricted** | irreversible / financial / credential-sensitive | money transfers, crypto withdrawals, password/2FA changes, creating financial credentials or API keys, destructive critical-data operations | **never executed by Computer.** Operanto may observe, navigate, and prepare context up to the final act; the irreversible action is performed manually by the authorized user. Maps onto `BLOCKED` semantics: no approval can authorize it, structurally |

Notes:

- "Automatic" at R0/R1 still means: permission-checked with the acting
  human's context, tenant-scoped, restriction-gated, budget-metered, and
  audited — automatic never means ungoverned.
- R2/R3 approval flows through the unified `ApprovalRequest` exactly like
  reply drafts today: risk snapshot at request time, server-side policy
  at decision time, atomic decision claim, separate atomic execution
  claim.
- R4 relaxation would require a future explicit written policy decision
  per organisation and per action class; no such policy exists and none
  is planned. The default is permanent.
- The tool definition's current axes (`permission`, `mutating`) are too
  coarse for this ladder; C1 is expected to add a risk-tier field to
  Computer tool definitions. That is a C1 design item, not a C0 change.

## 8. Observation model: DOM + accessibility + vision

Future browser observation combines four sources, in priority order:

1. **DOM-derived structure** — the factual skeleton of the page;
2. **Accessibility tree** — semantic roles and names
   (`role=button name="I've sent the funds"`), the primary addressing
   mode for actionable elements;
3. **Visible text** — what a human actually sees, extracted as data;
4. **Screenshot / vision** — layout understanding, visual verification,
   and the record of what was on screen.

Actions address elements semantically (role + accessible name +
context), never primarily by pixel coordinates. Coordinate clicking may
exist as an explicit last-resort fallback with its own audit marker — a
click that cannot be bound to a semantically identified element is a
signal of uncertainty, and uncertainty fails closed: **an ambiguous
element is never clicked because the model guessed.** When observation
and intent cannot be reconciled, the step stops and hands over (§12).

## 9. Verification, failure handling

Every mutating Computer action records enough metadata to answer "what
did we believe, what did we do, what happened": risk tier, reason,
status, before-state, after-state, approval linkage, execution
timestamps, verification result (the C1 data-model sketch in §14
carries these).

- After every R2/R3 execution the after-state is *observed*, not
  assumed: re-read the page/record and compare against the intended
  outcome. A failed or unverifiable action is FAILED, never silently
  "probably fine".
- Retries are bounded and idempotency-keyed following the proven
  claim-before-side-effect pattern (`Message.clientDedupeKey` is claimed
  by unique constraint *before* any provider call in
  `src/lib/services/whatsapp-send.ts`); a step that cannot verify its
  own precondition does not retry blind.
- Failure routes to the same places the rest of Operanto already uses:
  the conversation/task that motivated the work, with human handover and
  an audited failure reason. No dead ends, no silent drops.

## 10. Permissions (reserved, not added in C0)

The permission catalog lives in code (`src/lib/rbac.ts`: the
`Permission` union and role matrix). The audit confirmed adding a
permission is a **code-only change** — no migration or seed is involved
(roles are the Prisma `MembershipRole` enum; permission strings are
never persisted). C0 **reserves** four permission semantics:

| Reserved semantic | Meaning |
|---|---|
| `computer:read` | view Computer sessions, observations, artifacts |
| `computer:operate` | initiate/drive R0–R2 Computer work |
| `computer:approve` | decide Computer `ApprovalRequest`s (R2-by-policy, R3) |
| `computer:admin` | configure Computer policy for the organisation |

Decision: **these are reserved here but not added to `src/lib/rbac.ts`
in C0.** The catalog already carries ten Growth permissions declared in
G1 that no surface enforces yet — a known finding, not a pattern to
extend; G1 at least shipped its domain models alongside them, while C0
ships no Computer domain at all. Dead entries would mislead the security
review and the RBAC tests. The union and matrix are extended in C1
together with the domain foundation and the first surface that checks
them.

Two spellings are left to C1, to be decided with the first surface:

- **Family:** the catalog currently holds two conventions — the
  legacy-majority `namespace:verb` colon family (`ai:run`,
  `approvals:decide`, all Growth) and the canonical dot family
  introduced by OI-3 (`crm.view`, `crm.leads.view_all`). Computer should
  follow whichever convention is canonical when C1 lands
  (`computer:read` vs `computer.sessions.view`).
- **Read verb:** `test/crm-rbac.test.ts` asserts AUDITOR read-onlyness
  by a regex over permission *names* (`:view`/`.view_*` patterns) —
  naming is load-bearing. `ai:read`/`approvals:read` are existing
  precedent for `:read`, but if AUDITOR is ever granted Computer
  visibility, a `:view`-family name avoids weakening that test.

Role mapping (sketch, to be ratified in C1): ADMIN all four; SUPERVISOR
read/operate/approve; OPERATOR read/operate on assigned records; AUDITOR
none. `computer:approve` deliberately parallels `approvals:decide`;
whether it collapses into `approvals:decide` or stays separate is a C1
decision to take with the first real approval surface.

## 11. Integration with AIAction and ApprovalRequest (future)

No schema changes in C0 — none are necessary, which the audit confirmed:

- `AIAction` has **no executor enum** to amend (`provider` + `model` are
  strings); planning/understanding calls behind Computer become ordinary
  AIAction rows, likely with new `AITaskType` values in C1+.
- `ApprovalRequest.actionType` is already a **string**, so Computer
  action types (e.g. `computer.submit_form`) need no enum migration;
  `ApprovalSourceType` gains a value (e.g. `COMPUTER_ACTION`) only when
  C1 creates the first producer.
- The conceptual executor routing — a proposed action resolves to
  `INTERNAL_TOOL | CONNECTOR | COMPUTER` (or human) — remains a
  documentation-level concept until the Guarded Agent Runtime slice
  defines the tool registry it applies to. No core enum is modified on
  speculation.

The invariant that carries over unchanged: **approval and execution are
different acts.** Approving a Computer action authorizes exactly one
typed, already-inspected action; execution claims it atomically,
executes deterministically, verifies, and audits. Nothing about Computer
weakens the never-auto-send invariant or the RECORDED-message semantics
of `docs/operanto-ai-handover.md`.

## 12. Sessions, identity, credentials, takeover

- **Session isolation.** Browser/computer sessions are isolated per
  organisation and per acting user; nothing is shared across tenants —
  not cookies, not storage, not processes. A session that cannot prove
  its tenant binding is terminated, not reused.
- **Credentials.** The intended C2 direction is a controlled browser
  bridge in which **the user authenticates directly with the target
  application; Operanto does not need, hold, or see the user's website
  password.** Target-system credentials are never exposed to the LLM.
  Credential vaulting (Operanto-held logins) is explicitly deferred and
  would be its own ADR with its own threat model.
- **Secrets in telemetry.** Passwords, 2FA codes, session tokens, auth
  cookies, private keys, and similar secrets are never logged, never
  audited, never persisted in observations — extending the existing
  ids-only audit discipline. Field-level masking for known-sensitive
  inputs (password fields) is a C1/C2 design requirement.
- **Artifacts.** Screenshots and extracted page content are customer
  content: they join the content-persistence inventory
  (`docs/operanto-ai-handover.md` pattern), register with `eraseCustomer`,
  honour restriction of processing, and receive a retention decision at
  design time — before the first artifact is ever stored. Note the repo
  currently has **no binary artifact model at all** (attachments are
  explicitly deferred; the closest precedent is the opaque `storageRef`
  contract in `packages/crm-voice`): a Computer screenshot would be
  Operanto's first stored binary, so C1/C2 must land the blob storage,
  erasure, and retention design together with — not after — the first
  artifact write.
- **Takeover.** A human can interrupt or take over a Computer session at
  any time, mirroring `Conversation.handling`; takeover is audited, and
  handback (if any) is an explicit act. R4 flows are *designed around*
  takeover: Operanto prepares, the human commits.

## 13. Operational / procedural memory (direction only)

Operanto should eventually learn how recurring work is performed — "to
investigate a failed publication: open Publications, search the id,
inspect processor state, inspect logs, check support history, create a
resolution task" — and replay that knowledge as a *reviewed procedure*,
not as blind repetition. Candidate future concepts: ComputerSkill,
ApplicationMap, KnownWorkflow, PagePattern, ActionRecipe,
SuccessfulActionSequence, FailurePattern.

**None of these are modelled in C0**, and C1 should model at most what
its first slice demonstrably needs. Learned procedures are organisation
knowledge (Memory capability) with Computer as a consumer; they carry
provenance (which sessions taught them), are tenant-scoped, and never
auto-promote from "observed once" to "trusted procedure" without review.

## 14. Explicitly deferred

Deferred from C0 (each requires explicit future authorization):

- browser extension / browser bridge (C2 direction);
- Playwright or any browser-driving runtime;
- browser-use or similar frameworks;
- computer-use provider integrations;
- any autonomous browser action, including R0 observation off a model's
  own decision;
- application-specific skills (Shopify, DHL, …);
- credential vaulting;
- multi-application execution;
- Computer permissions in `src/lib/rbac.ts` (§10);
- schema changes of any kind (§11);
- operational-memory models (§13).

Likely C1 (**proposal only — NOT authorized by C0**): domain foundation
for `ComputerSession`, `ComputerObservation`, `ComputerPlan`,
`ComputerStep`/`ComputerAction`, `ComputerArtifact` — organisation-scoped,
linked to membership/conversation/customer/task/AIAction/ApprovalRequest,
each action carrying risk, reason, status, before/after state, approval
linkage, execution timestamps, and verification result; the `computer:*`
permissions with their surfaces; the risk-tier field on Computer tool
definitions; erasure/restriction/retention coverage with tests; no
browser control. C2 sketch: a controlled browser bridge exposing current
URL, title, visible text, DOM subset, accessibility information,
interactive elements, and viewport screenshot, with user-held
authentication.

## 15. Naming and product identity

Computer is a capability of the one product, per
`docs/operanto-product-architecture.md`: "Operanto Computer" is the
reserved capability name; no standalone brand, no separate repository.
The prompt-level concept names map onto existing repo vocabulary rather
than renaming it: "Context" ≈ Operanto Memory, "Work" ≈ Operanto
Workflows. The target tree in `docs/operanto-target-architecture.md`
gains the `Computer` line; nothing else in the tree changes, and no
source tree is refactored to mirror the diagram.

## 16. Gate confirmation

This PR deliberately contains **no**: Computer code, browser control,
Playwright execution paths, Chrome extension, autonomous clicking,
production computer-use functionality, database migration, Prisma schema
change, permission-catalog change, feature flag, navigation entry,
route, UI surface, or test for functionality that does not exist.
Existing behavior is unchanged; Computer is dormant by construction. The
2026-08-02 agent-runtime gate ("nothing agentic until the WhatsApp pilot
findings are reviewed") holds unmodified.

## 17. Assumptions and open questions

- **Assumption:** the Guarded Agent Runtime slice lands before Computer
  C1, so C1 builds on its tool registry and invariants rather than
  inventing a second runtime. If sequencing changes, C1's design must be
  re-reviewed against §5.
- **Open:** whether `computer:approve` merges into `approvals:decide`
  (§10).
- **Open:** artifact storage location and retention default for
  screenshots — shared with the deferred message-attachment work, since
  no blob store exists in the repo today (§12).
- **Open:** the per-organisation policy shape that relaxes R2 actions
  from approval to audited-automatic (relates to the existing
  deny-by-default approval policy on the tool runtime).
- **Risk:** scope creep — "just one small Playwright spike" outside the
  gate. Mitigation: this ADR's §16 is the review checklist; any Computer
  execution code in a PR without a C1 authorization reference is a
  review rejection.
- **Risk:** prompt injection via page content is the defining threat of
  C2+ (§5); the injection eval suite must exist before the first
  Computer read tool executes off a model's decision — merge gate, not
  follow-up.
