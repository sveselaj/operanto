# Operanto target architecture

Defines the bounded capabilities Operanto grows into as prototype
functionality is consolidated (see `docs/operanto-capability-gap-analysis.md`
for what exists where, and `docs/operanto-product-architecture.md` for the
naming policy). The controlling rule everywhere: **reuse main's spine** —
Organisation/Membership tenancy, the RBAC matrix, the audit log, the customer
identity ladder, the privacy lifecycle, and the store-then-process event
pipeline are canonical, and every consolidated capability plugs into them
rather than bringing its own.

```text
Operanto
├── Memory          Customer, CustomerIdentity, Activity, PropertyContext, org knowledge
├── Conversations   channels → normalized messages → unified inbox → handover
├── Workflows       tasks, approvals, escalations, (later) workflow definitions
├── Intelligence    AI tasks + typed tool gateway + approval gates + AIAction audit
├── Computer        governed operation of software UIs where no API suffices (C0: docs only)
├── Growth          brand profile, campaigns, content — on shared context
└── Integrations    signed domain events (Pronatona, …) + channel connectors
```

Internal engine names (`mediasync`, `synco`, `opsync`, `brandforge`) may name
bounded contexts in code and docs; they never appear in customer-facing
surfaces.

## Principles

1. **Additive schema evolution.** New capabilities arrive as new tables and
   nullable columns via `prisma migrate`; no destructive migration without
   written justification, backup/rollback plan, and explicit approval.
2. **One tenancy model.** Every new row carries `organisationId`; assignment
   references `Membership`, never `User`. Record-level access is composed
   into queries (`…AccessWhere()` pattern), never checked post-fetch.
3. **Store, then process.** Anything arriving from outside (domain events,
   channel webhooks) is persisted raw with a unique idempotency constraint,
   acknowledged, and processed asynchronously with atomic claims, bounded
   retries, and a dead-letter state — the proven `InboundEvent` pattern.
4. **Deterministic gateway for AI.** The AI layer proposes; deterministic
   code disposes. Every side effect flows through the typed tool runtime,
   which enforces RBAC, approval policy, idempotency, and audit — the model
   cannot bypass any of them.
5. **Human approval before anything reaches a customer.** Outbound sends,
   publishes, and stage-changing actions are approval-gated until an explicit
   per-organisation policy relaxes a specific action. Confidence scores gate
   *suggestions into queues*; they never authorize autonomous sends.
6. **Privacy is a first-class surface list.** Every model holding customer
   content registers with `eraseCustomer` (redact-in-place), honours
   restriction of processing, and gets a retention decision at design time.
7. **No empty UI.** Navigation entries appear only when a slice ships usable
   functionality.

## Operanto Conversations

Responsibilities: channel ingestion, unified customer conversations, message
threading, identity resolution, normalization, inbox filtering, ownership and
assignment, internal notes, attachments, status, AI-assisted drafting,
AI-to-human handover.

### Entities (target state; mapped onto existing models)

> Slice 1 (2026-08-01) delivered `Conversation`, `Message`,
> `ConversationNote`, `ConversationParticipant` (with an additional
> `membershipId` for staff-side rows), and `ChannelConnection`
> (MANUAL/SIMULATOR, no credential columns yet), plus
> `Activity.conversationId` and `Organisation.messageRetentionDays`. One
> deliberate deviation: `MessageDirection` is INBOUND/OUTBOUND only —
> internal commentary lives exclusively in `ConversationNote`, so a
> direction flag can never leak a note outbound. Attachments, unread state,
> and `CustomerIdentity` remain open as planned.

| Conceptual entity | Realisation |
|---|---|
| `Customer` | **Existing model, reused.** Never duplicated. |
| `CustomerIdentity` | Delivered in Slice 2: `(organisationId, channelType, externalId, displayHandle, source)` unique per org+channel+externalId — the exact-match rung ahead of e-mail for channel ingestion. Taught by explicit linking, withdrawn on unlink, DELETED on erasure. `verifiedAt` deferred. |
| `Conversation` | New: `organisationId, customerId?, channelConnectionId?, channelType, status (OPEN/PENDING/WAITING_CUSTOMER/RESOLVED/ARCHIVED), priority, handling (AI/HUMAN), assignedMembershipId?, subject?, summary?, intent?, sentiment?, lastMessageAt, lastInboundAt, lastOutboundAt, erasure/restriction fields`. Optional `opportunityId` link. |
| `ConversationParticipant` | Deferred: 1:1 customer↔staff conversations first. Group participation modelled only when a channel demands it (email CC). |
| `Message` | New: `direction (INBOUND/OUTBOUND), senderType (CUSTOMER/STAFF/AI/SYSTEM), senderMembershipId?, body, status (QUEUED/SENT/DELIVERED/READ/FAILED), statusUpdatedAt, errorMessage?, externalMessageId, templateId?`. **`@@unique([organisationId, channelConnectionId, externalMessageId])`** — dedupe by constraint, not read-then-write. |
| `MessageAttachment` | New: metadata row + blob storage key; media fetched from providers and persisted, never dropped. Erasure deletes blobs. |
| `ChannelConnection` | New (prototype `ChannelAccount`, renamed): per-org channel config, credentials encrypted with main's `OPERANTO_ENCRYPTION_KEY` crypto, `@@unique([channelType, externalAccountId])` for tenant resolution. |
| `ConversationAssignment` | Field (`assignedMembershipId`) + `Activity`/`AuditEvent` trail, mirroring how `Opportunity` assignment works. No separate table. |
| `ConversationNote` | New: internal notes, separate from `Message` (cleaner permission and erasure semantics). |
| `ConversationEvent` | **Not a new table.** Conversation lifecycle events are `Activity` rows (`conversation.created`, `conversation.assigned`, `conversation.status_changed`, …) plus `AuditEvent` for staff actions — one timeline, one audit log. |

Threading: one open conversation per `(customer, channelConnection)`;
provider thread ids stored on `Conversation.externalThreadId` when a channel
supplies them. Unread state: per-membership `lastReadAt` marker (design in
Slice 1, may ship later).

### Channel adapter contract

The prototype's `Channel` interface (branch `origin/mediasync-communication-layer`,
`src/lib/channels/types.ts`) is adopted with minor renames, aligned to:

```ts
interface ConversationChannelAdapter {
  readonly type: ChannelType;
  verifyChallenge(url: URL): string | null;
  verifySignature(headers: Headers, rawBody: string, conn: ChannelConnection): boolean;
  classifyEvent(payload: unknown): "message" | "status";
  connectionRef(payload: unknown): string | null;   // provider account id → tenant
  receiveEvents(payload: unknown): NormalizedChannelEvent[];
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  verifyConnection(conn: ChannelConnection): Promise<ConnectionStatus>;
}
```

Rules: signature verification takes the resolved connection (per-tenant
secrets are possible even if v1 uses app-level secrets); an adapter that
cannot resolve a tenant **rejects** the event — there is no cross-tenant
fallback lookup.

Channel rollout (product-owner decisions 2–3): Slice 1 ships manual entry
plus a deterministic simulator adapter; a controlled web-chat channel may
follow; the first live external connector is the **WhatsApp Cloud API**,
served by **one Operanto-managed Meta application** with each organisation
connecting its own WhatsApp Business Account and phone number
(`ChannelConnection` holds the per-org WABA id, phone-number id, and
encrypted tokens). The adapter contract stays provider-neutral so BSP
providers can be added later. Telegram is not currently a priority.

### Ingestion pipeline (mirrors the Pronatona pipeline)

```text
POST /api/webhooks/{channel}
  rate limit → resolve connection → verify signature (raw body)
  → store ChannelInboundEvent (unique on connection + dedupeKey) → 202
after()/cron: atomic claim → adapter.receiveEvents → identity ladder
  (+ CustomerIdentity rung) → conversation upsert → Message insert
  (unique constraint) → Activity → consent bookkeeping
  → retries → DEAD_LETTER + admin retry UI
```

Outbound controls (decision 5): every send passes consent state, the
channel's template and messaging-window policy (e.g. WhatsApp's 24-hour
window), the approval gate where policy requires one, and audit logging —
and fails safe (a policy or connector failure never drops a message
silently or sends without a check). Compliance policy is configurable per
channel and per tenant. Consent (`Consent` model, STOP/START keywords) is
checked before every outbound send; sends record delivery status
transitions monotonically.

## Operanto Workflows

Responsibilities: tasks, assignments, approvals, follow-ups, deadlines,
escalations, status transitions, business events, auditability.

- `Task` — **existing model, extended additively**: nullable
  `conversationId`, richer status values appended to the enum, unit tests
  added. Existing SLA auto-task and access-scope logic unchanged.
- `ApprovalRequest` — **one unified model** for both prototype lineages:
  generic `(entityType, entityId, action, payload, status, requestedBy,
  decidedBy, expiresAt)` with tenant-scoped uniqueness on the pending gate.
  Two producers: the AI tool runtime (tool invocations awaiting approval)
  and business actions (send quote, publish content, outbound message). One
  queue UI, `approvals:decide` permission, atomic decide (conditional
  `updateMany` claim, from the legacy runtime).
- `Escalation` — later: time/condition rules that flag conversations, tasks,
  or approvals; built with the notification decision.
- `WorkflowDefinition/Step/Instance/Transition` — later, on demonstrated
  need; the pure evaluator (`workflow-eval.ts`) ports first.
- **The `Opportunity` collision is resolved by separation, not merging**
  (decision 10). The existing `Opportunity` model is, and remains, the
  Pronatona real-estate projection (stage enum, `sourceStage`,
  `PropertyContext`, event-driven upserts). The prototype's `Opportunity`
  (open/won/lost pipeline with requirements, quotes, workflow instances) is
  a *different* bounded concept — a general commercial pipeline — and if it
  is ever built it arrives as its own model under its own name. Incompatible
  shapes are never merged under one generic entity. `Conversation` links to
  the existing `Opportunity` where relevant and never replaces it.
- `OperationalEvent` — **not a new table**: `Activity` (domain timeline) +
  `AuditEvent` (compliance) remain the two event stores.

## Operanto Intelligence

> Slice 4 (2026-08-02) delivered the foundation described below: the
> provider-neutral AI layer (OpenAI behind the interface, deterministic mock
> default), `AIAction`, the unified `ApprovalRequest` with atomic decisions,
> `Conversation.handling` takeover/release, tenant-level configuration with
> budget enforcement, the deny-by-default tool-runtime foundation, and
> privacy/retention coverage of AI surfaces. See
> `docs/operanto-ai-handover.md`.

Responsibilities: intent classification, context assembly, summarisation,
recommended replies, next-best actions, confidence scoring, routing and
escalation recommendations, AI-human orchestration, tool-use policies,
outcome learning.

Architecture (ported from the legacy prototype, adapted to main):

- `runAITask(ctx, task, input)` — single entrypoint; `requirePermission("ai:run")`;
  Zod-validated forced-tool structured output with one retry; every call
  persists an `AIAction` row (model, `prompt@version`, PII-trimmed input
  context, output, confidence, status). Mock mode (`AI_PROVIDER=mock` or no
  API key) keeps every feature demoable and testable offline, and **remains
  the default for tests and staging** (decision 6).
- Provider strategy (decision 6): the provider abstraction is the boundary —
  domain code calls tasks, never a vendor SDK. **OpenAI is the initial
  production provider** for summarisation, classification, and draft
  replies; the prototype's Anthropic adapter shows the adapter shape and
  further providers plug in behind the same interface. Tenant-level model
  selection, usage limits, and budget controls are part of the AI layer's
  contract: per-organisation provider/model configuration and metered usage
  with enforced caps (refuse-with-explanation on budget exhaustion, never
  silent degradation).
- Typed tool runtime — the **only** way AI produces side effects: Zod input
  validation → RBAC check with the *acting human's* context → approval
  policy (deny-by-default; `always`-gated for outbound/irreversible actions)
  → idempotent execution (tenant-scoped idempotency keys) → output
  validation → audit. Approval creates an `ApprovalRequest`; execution never
  happens before a decision.
- Confidence policy — explicit thresholds configured per task category
  decide whether a suggestion is shown, queued for review, or discarded.
  **No threshold authorizes an autonomous customer-facing send.** The
  never-auto-send invariant is enforced structurally (no send path outside
  the gated tool) and covered by tests.
- Handover — `Conversation.handling` (AI/HUMAN) + takeover/release actions,
  audited; staff reply always flips to HUMAN.
- Guardrail prompt blocks (anti-fabrication, prompt-injection defence:
  customer text is data, never instructions) ship with every task.
- Intelligence has **no navigation item initially** — it surfaces inside
  Conversations (summary, draft, classify), Customers (context), and
  Workflows (suggested tasks).

## Operanto Computer

> C0 (2026-08-07) ratified Computer as a bounded capability; C1 (same
> date, separately authorized) delivered the dormant **domain
> foundation** — session/plan/step/action/snapshot models, risk floors,
> unified approval integration, `computer:read`/`computer:operate`, and
> privacy lifecycle coverage. C2 (same date, separately authorized)
> added the **read-only browser bridge**: explicit tab-share via an MV3
> extension, session-bound short-lived tokens, authoritative server-side
> sanitization, flag-gated off by default. **No executor exists**: no
> click/type/navigate/submit, no external effect, no UI. Decision record:
> `docs/operanto-computer-capability.md`; slice notes:
> `docs/operanto-computer-c1.md`, `docs/operanto-computer-c2.md`. Every
> execution slice requires explicit authorization.

Mission: allow Operanto to safely observe and operate software interfaces
when a trusted deterministic or API integration does not exist or is
insufficient. Computer is **another execution mechanism, not another
product** — the canonical loop (conversation → context → intelligence →
plan → execution → verify → outcome → memory) stays unchanged, and each
plan step routes to exactly one of:

```text
native Operanto tool | API connector | Computer | human
```

in that order of preference — **API-first, computer-capable**: where a
reliable API exists, routing that operation through a browser is a
defect.

Rules (details and the R0–R4 risk ladder in the ADR):

- Same spine, no parallel frameworks: tenancy, RBAC, record scope,
  `AIAction`, the unified `ApprovalRequest`, ids-only audit, privacy
  lifecycle, constraint-based idempotency, budgets, human takeover.
- The model proposes typed actions; the deterministic layer disposes.
  Ambiguity, unknown tenant, or unclassifiable policy → fail closed.
- Observation is semantic (DOM + accessibility roles + visible text +
  vision); coordinate clicking is a last-resort fallback, never the
  addressing model. Page content is data, never instructions.
- Commits (R3) always gate through `ApprovalRequest`; restricted actions
  (R4: money movement, credential/2FA changes, destructive operations)
  are never executed by Computer — the human performs the final act.
- Sequencing: Computer execution slices arrive *inside* the Guarded
  Agent Runtime discipline (`docs/operanto-agent-runtime-conversation.md`)
  as a capability pack of tools; the 2026-08-02 gate holds.

## Operanto Growth

Responsibilities: editable brand profile, product/service knowledge,
audiences, campaign opportunities, content generation, multilingual
campaigns, approval and scheduling, result tracking.

Built last, on the shared spine — **not an isolated content generator**:

- `BrandProfile` (evolves the prototype `BrandVoice`: tone, dos/don'ts,
  example phrases, languages) — editable in settings.
- `Campaign` + `ContentDraft` — drafts generated via `runAITask` with the
  brand block, approval-gated before any publish/send, linked to the
  conversations and opportunities they produce (attribution from day one).
- Publishing reuses `ChannelConnection` and the outbound gateway — no
  separate social credentials or send path.

## Cross-cutting decisions

- **Permissions** (additive to the 3-role matrix; expansion to more roles is
  a product decision): `conversations:view_all | view_assigned | reply |
  assign | manage`, `channels:manage`, `ai:run`, `approvals:decide`,
  `growth:manage`, `templates:manage`. Computer (since C1):
  `computer:read` and `computer:operate` exist in `src/lib/rbac.ts`
  (ADMIN + SUPERVISOR); `computer:approve` was **not** created —
  decisions on Computer approvals reuse `approvals:decide`; and
  `computer:admin` stays deferred until an actual configuration surface
  requires it. Decision history: `docs/operanto-computer-capability.md`
  §10 and `docs/operanto-computer-c1.md`.
- **Privacy** (decision 9): `eraseCustomer` gains surfaces — Conversation
  subject/summary, Message bodies + attachments (blob deletion),
  ConversationNote, AIAction input/output, CustomerIdentity. Message-payload
  retention is configurable per organisation with a **provisional default of
  12 months**; restriction and erasure requirements always take precedence
  over retention. Raw `ChannelInboundEvent` payloads follow the existing
  30-day redaction pattern. Longer-lived audit records carry minimal
  non-content metadata — never full message bodies. The production retention
  policy requires contractual and legal confirmation before launch. Consent
  records are kept as compliance evidence, like audit events.
- **Navigation end state** (each entry appears only when usable): Dashboard,
  Conversations, Customers, Opportunities, Tasks, Growth, Activity,
  Integrations, Settings, Audit log.
- **Legacy branch disposition** (decision 7): `origin/mediasync-communication-layer`
  is not altered or deleted during audit or early implementation. Once all
  approved reusable components are transplanted, an immutable archive tag
  plus remote-branch deletion will be proposed as a separate action. Its
  schema is never replayed — all schema arrives as fresh additive migrations
  on main.

## Explicit non-goals (now)

Autonomous outbound AI replies; many simultaneous half-working channel
integrations; a visual workflow builder; group/multi-participant
conversations; per-message realtime transport (poll/refresh first); the
commerce suite (quoting, catalogue, business rules, appointments, document
extraction) — deferred by decision 1 as future vertical capabilities
(Nagelista, Pronatona, and other adapters); Telegram and Infobip connectors
(deprioritised by decision 2).


## Delivered addendum (2026-08-03)

Growth Prospecting Program G1+G2 delivered (flag-gated, no external
execution): 13 org-scoped Growth entities, 17 permissions, lifecycle
machine, staged CSV import with constraint-backed dedupe, suppression and
privacy lifecycle integration. See docs/operanto-growth-g2.md.

## Amendment addendum (2026-08-07)

Computer C0 ratified: Computer joins the capability tree as a bounded
capability, documentation only — no code, schema, permissions, flags, or
UI. Decision record, risk ladder (R0–R4), governance mapping, and
deferred C1/C2 direction: docs/operanto-computer-capability.md.

Computer C1 delivered (same date, separately authorized): dormant domain
foundation — 5 org-scoped models, R0–R4 risk enum with type floors,
COMPUTER_ACTION approvals through the unified gate, computer:read/operate
(ADMIN+SUPERVISOR; approvals:decide reused for decisions), erasure/
restriction/retention coverage, ids-only audit. No executor, no UI, no
external effect. See docs/operanto-computer-c1.md.

Computer C2 delivered (same date, separately authorized): read-only
browser bridge, flag-gated off (OPERANTO_COMPUTER_BRIDGE_ENABLED) — MV3
extension (explicit tab share, activeTab), ComputerBridgeGrant pairing
tokens (SHA-256 at rest, 60-min expiry, revoked on session close),
Bearer-only ingestion endpoints, authoritative server sanitization, and
the dev-database guard (scripts/db-guard.ts) hardening migrations after
the C1 incident. Observation is one-way; still no executor. See
docs/operanto-computer-c2.md.
