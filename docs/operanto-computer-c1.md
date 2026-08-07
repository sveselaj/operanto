# Operanto Computer C1 — domain foundation

Status: **delivered 2026-08-07, dormant.** C1 gives Computer a durable,
tenant-safe domain model and its first enforcement surfaces — and nothing
else. There is **no executor**: no browser, no Playwright, no extension, no
CDP, no screenshot/DOM/accessibility capture, no autonomous action, no
credential storage, no UI, no navigation entry. Rows created through these
services are *representations* of governed computer work that a future,
separately authorized slice would execute. The 2026-08-02 agent-runtime
gate (docs/operanto-agent-runtime-conversation.md) holds unmodified.
Decision record: docs/operanto-computer-capability.md (C0 ADR).

## What this slice ships

```text
Conversation / Task / Customer context
        ↓
ComputerSession        one bounded attempt to advance a goal
        ↓
ComputerPlan (vN)      immutable, versioned intent — supersede, never edit
        ↓
ComputerStep           ordered intent, each with a planned route:
                       NATIVE_TOOL | CONNECTOR | COMPUTER | HUMAN | NONE
        ↓
ComputerAction         typed proposal (OBSERVE … SUBMIT) with risk tier,
                       rationale, semantic target, confidence 0..1
        ↓
R0/R1 → PROPOSED       R3 → APPROVAL_PENDING + unified ApprovalRequest
R2 → PROPOSED          R4 → BLOCKED at birth, no approval path, ever
        ↓
[execution — DOES NOT EXIST in C1]
        ↓
ComputerSnapshot       before/after representation (immutable, untrusted)
        ↓
Verification           one-shot VERIFIED | FAILED | INCONCLUSIVE + note
```

- **Schema** (`prisma/migrations/20260807152421_computer_c1_domain_foundation`,
  purely additive): `ComputerSession`, `ComputerPlan`, `ComputerStep`,
  `ComputerAction`, `ComputerSnapshot`; enums for status, action type, risk
  tier (`R0_OBSERVE … R4_RESTRICTED`), step route and verification result;
  one new `ApprovalSourceType` value `COMPUTER_ACTION`. Links: organisation
  (Cascade), creating membership (SetNull), conversation (Cascade), customer
  (Restrict), task (SetNull), proposing `AIAction` (SetNull). Idempotency by
  constraint: `(sessionId, version)` on plans, `(planId, position)` on
  steps, and the existing `(organisationId, sourceType, sourceId)` on
  approvals — one action, one gate.
- **Policy** (`src/lib/computer/policy.ts`, pure): risk floors per action
  type (SUBMIT can never be classified below R3), the documented tier →
  `AIRiskLevel` mapping (R0/R1→LOW, R2→MEDIUM, R3→HIGH, R4→BLOCKED), legal
  state transitions, confidence range 0..1, and strict Zod schemas for
  targets and snapshot elements.
- **Services** (`src/lib/services/computer.ts`): create/list/get sessions,
  propose plans (supersede + version atomically), mark ready, record
  snapshots, propose actions, cancel actions/sessions, record verification,
  conclude. Every mutation is permission-gated, tenant-scoped, transition-
  checked with conditional updates, and audited ids-only.
- **Approvals** (`src/lib/services/approvals.ts`): `decideApproval` now
  mirrors decisions onto `ComputerAction` (`APPROVAL_PENDING → APPROVED |
  REJECTED`) exactly as it does onto `AIAction`; computer approvals are not
  editable and can never be applied as conversation messages
  (sourceType-guarded).
- **Privacy** (`src/lib/services/privacy.ts`): `eraseCustomer` redacts the
  whole computer graph of customer- and conversation-linked sessions
  (goal, summaries, titles, rationale, targets, snapshot content, approval
  payloads) while the operational shell survives; restriction blocks new
  computer work for the customer and pauses disposal;
  `redactExpiredComputerContent` sweeps on the per-organisation message
  window from the existing 5-minute cron.

## Lifecycle (no state pretends execution)

```text
Session: CREATED → PLANNING → READY → COMPLETED | FAILED
              └──────┴──────────┴───→ CANCELLED
Action:  PROPOSED | APPROVAL_PENDING → APPROVED | REJECTED
         R4: BLOCKED (terminal at birth)  ·  any open → CANCELLED
```

There is deliberately no `ACTIVE`, no `EXECUTING`, no `EXECUTED`.
`COMPLETED`/`FAILED` are human-recorded conclusions from `READY` (e.g. the
R4 pattern: Operanto prepared, the authorized human performed the final act
manually and recorded the outcome). Approval-waiting is action-level state,
never duplicated on the session. A session with an undecided approval
cannot be concluded. Verification is one-shot, and only on an open
proposal or an APPROVED commit — never on `APPROVAL_PENDING`, so an
unapproved R3 can never look executed.

## Permission decision (C0 §10 resolved)

Added, both enforced and integration-tested: **`computer:read`** (list/get)
and **`computer:operate`** (create/propose/record/cancel/conclude) — colon
family beside `ai:*`/`approvals:*`, granted to ADMIN and SUPERVISOR.
OPERATOR/AUDITOR get neither (expansion is a product decision for a later
slice). **`computer:approve` was not created**: decisions on Computer
approvals reuse `approvals:decide` — one approval authority, one queue, no
second framework. **`computer:admin` was not created**: C1 has no Computer
configuration surface, and a permission no surface checks would be a dead
catalog entry. Zero declared-but-unenforced Computer permissions exist.

## Security posture

- **R4 is structural, not advisory**: `R4_RESTRICTED` actions are born
  `BLOCKED`, terminal, with no `ApprovalRequest` — and even a hand-crafted
  approval row for one carries `riskLevel: BLOCKED`, which
  `canApproveDraft` refuses to approve. Computer cannot execute R4 in any
  slice without changing ratified policy in writing.
- **Confidence is never authorization**: it feeds the existing
  low-confidence acknowledgement flow on the approval gate; no value skips
  RBAC, policy or approval, and out-of-range values are rejected.
- **Secrets have no field to live in**: targets and snapshot elements are
  strict-parsed shapes (role/accessible-name addressing); element *values*,
  coordinates-as-primary, cookies, tokens and passwords are unrepresentable
  and tested as rejected. Free-form JSON dumps do not exist in the model.
- **Injection boundary**: session goals/plans/reasons are trusted Operanto
  control data; snapshot content is untrusted observation data. No service
  reads snapshot content to decide policy, status, approval or lifecycle —
  integration-tested with hostile snapshot text, which changes nothing and
  never reaches audit metadata.
- **Audit is ids-only**: `computer.session.created`, `computer.plan.proposed`,
  `computer.action.proposed/.blocked/.approved/.rejected/.cancelled`,
  `computer.approval.requested`, `computer.snapshot.recorded`,
  `computer.verification.recorded`, `computer.session.ready/.concluded/
  .cancelled` — ids, enums and counts; never goals, reasons, targets, URLs
  or page text (integration-tested).

## Deliberately deferred

`ComputerArtifact` and any binary storage (no blob model exists repo-wide;
the design lands with the first artifact write, per the C0 ADR), browser
bridge/observation transport (C2), execution of any kind, per-organisation
R2 approval-relaxation policy (meaningful only with an executor),
`computer:admin` and a Computer configuration surface, operational-memory
models (ApplicationMap, ComputerSkill, …), OPERATOR/AUDITOR access, and
any UI.

## Operational note (staging)

During C1 development the migration was unintentionally applied to the
Neon **staging** database (the repo's `.env` points `DIRECT_URL` at Neon,
and Prisma migrations follow `DIRECT_URL`, not `DATABASE_URL`). The
migration is purely additive (empty tables/types, one enum value), touches
no data, and the deployed staging build references none of it, so it was
left in place; the migration file in this PR is byte-identical to what
staging already has, so `prisma migrate deploy` remains consistent. If C1
were rejected, cleanup is: drop the five `Computer*` tables and the seven
`Computer*` enum types (the extra `ApprovalSourceType` value is harmless
and would remain). Local development should override BOTH `DATABASE_URL`
and `DIRECT_URL` for every Prisma command.

## Validation

`pnpm lint` (0 errors) · `pnpm typecheck` · `pnpm test` — 348 unit tests,
40 files · `pnpm test:integration` against real PostgreSQL — 178 tests,
11 files, including the new `test/computer.integration.test.ts` (tenancy,
RBAC, lifecycle, risk floors, R4/BLOCKED semantics, unified approvals,
confidence, snapshots/verification, erasure/restriction/retention, audit
hygiene, injection boundary) and the unchanged AI/privacy/CRM/growth
suites.
