# Operanto capability gap analysis

Audited 2026-08-01. This document records where every capability of the
unified Operanto product currently lives — implemented on `main`, prototyped
on an unmerged branch, archived as reference code, specified in a document,
or missing entirely — and what to do with each. No runtime code was changed
as part of this audit.

Companion documents: `docs/operanto-target-architecture.md` (the architecture
these findings feed), `docs/operanto-product-architecture.md` (naming
policy), `docs/architecture.md` (the shipped event pipeline).

## Sources inspected

| Shorthand | Source | What it is |
|---|---|---|
| `main` | branch `main` @ `902d81d` (44 commits) | The shipped product: real-estate lead-projection cockpit fed by signed Pronatona events. Production-hardened tenancy, RBAC, 2FA, audit, privacy lifecycle, event pipeline. |
| `legacy` | `legacy/chat-cockpit-prototype/` (archives commits `55f451b` + `a1a8735`) | The chat-first cockpit prototype: inbox, AI assistant with typed tool runtime and approval gates, SOPs, automations, studio, analytics. 16k lines, import-broken as archived, not compiled. Its schema exists only in git (`a1a8735:prisma/schema.prisma`). |
| `msync` | branch `origin/mediasync-communication-layer` @ `b8da39b` (6 commits, unmerged) | Parallel evolution of the same MVP fork point (`55f451b`): live channel connectors (Meta WhatsApp/Messenger/Instagram, Telegram, Infobip Viber/SMS), consent, templates, delivery status, human takeover, plus operational phases A–H (lead engine, catalogue, quoting, approvals, workflow engine, scheduling, integration hub, document AI). +12,512 lines vs fork point. **Not duplicated anywhere on main.** |
| `spec` | Documents on the above sources | `msync:docs/MEDIASYNC.md` (channel architecture), `msync:docs/WORKFLOW_ENGINE.md` (470-line operational-layer design, mostly built), `legacy/docs/BLUEPRINT.md`, `legacy/docs/ai-tool-execution.md`, `legacy/docs/approval-workflows.md`, user/admin manuals on both prototypes. |

Branches `chore/upstash-readiness`, `ci/github-actions`, and
`feat/pronatona-projection-mvp` (local and origin) were inspected and are
**fully merged into main — zero delta**; they are stale pointers, not sources.
`fix/privacy-2fa-review-findings` and `docs/operanto-product-architecture`
are main+1 docs/fix branches with no capability content beyond main.

**Three lineages share one root** (`55f451b`, the original MVP): `legacy`
archives one descendant, `msync` is the other, and `main` restarted from the
archive commit with a projection-first architecture. Neither prototype knows
about main's Organisation/Membership tenancy, invitations, 2FA, rate
limiting, Sentry, privacy lifecycle, or migration-based schema management.

## Status vocabulary

`Implemented` · `Implemented but incomplete` · `Prototype only` ·
`Specification only` · `Missing` · `Obsolete` · `Duplicate` ·
`Requires manual review`. Dependencies are expressed through the backlog
ordering in §7.

---

## 1. Conversations (internal engine heritage: mediasync)

> **Slice 1 delivered (2026-08-01, `feature/operanto-conversations-foundation`):**
> conversation/message/note/participant/channel-connection data model,
> manual + simulator channels, list/detail UI, assignment, status, priority,
> customer linking, audit + Activity events, privacy-lifecycle integration
> with per-organisation message retention. See
> `docs/operanto-conversations-foundation.md`. Rows below are updated
> accordingly; everything else in this table remains open.

| Capability | Source | Location | Status | Maturity | Reuse recommendation | Migration risk | Next action |
|---|---|---|---|---|---|---|---|
| Conversation / Message / note / participant data model | Slice 1 (informed by `legacy`+`msync` shapes) | `prisma/schema.prisma` (Conversation, Message, ConversationNote, ConversationParticipant, ChannelConnection) | Implemented | Organisation/Membership tenancy, tenancy-scoped uniques, erasure + retention integrated. Tags deferred. | Extend, never replace | — | Slice 2 adds `CustomerIdentity` |
| Conversation list + detail UI | Slice 1 (rewritten on main patterns, not ported) | `src/app/(app)/conversations/*` | Implemented | List/detail with filters, search, pagination; no `alert()` error handling | Extend | — | Unread state + realtime later |
| Conversation status / priority / assignment / internal notes | Slice 1 | `src/lib/services/conversations.ts` (permission-gated, audited, conditional-claim updates) | Implemented | Working, unit + integration + e2e tested | Extend | — | — |
| Channel adapter contract | `msync` | `src/lib/channels/types.ts` (pure, no framework deps, constant-time HMAC helpers) | Prototype only | Clean, portable | Cherry-pick nearly unchanged | Low | Slice 5 (interface may land with Slice 1 simulator) |
| Meta connectors (WhatsApp Cloud, Messenger, Instagram) | `msync` | `src/lib/channels/providers/meta.ts` (tested in `connectors.test.ts`, 218 ln) | Prototype only | Working; attachments dropped as `"[image]"`; global app secret | Port and adapt after adapter framework lands; add per-tenant credential strategy, attachment persistence | High (external API, compliance) | Slice 5+ |
| Telegram connector | `msync` | `providers/telegram.ts` | Prototype only | Working but `accountRef()` returns null → **cross-tenant routing bug** in fallback | Port only with the tenant-resolution fix | High | Slice 5+ |
| Infobip Viber/SMS connectors | `msync` | `providers/infobip.ts` | Prototype only | Working | Defer; port after first channel proves the framework | Medium | Backlog |
| Web-chat widget + direct connector | `msync`+`legacy` | `app/widget/[channelAccountId]/`, `providers/direct.ts` | Prototype only | Working; public unauthenticated route, security = unguessable id | Requires manual review (abuse surface, rate limits, CSP) before porting | Medium | Slice 5 candidate as the “controlled simulator” |
| Email channel | `msync` | `providers/unconfigured.ts` (stub throws) | Missing | — | Specify (SMTP/IMAP or provider) before building | — | Backlog |
| Webhook receipt + dedupe (`WebhookEvent`) | `msync` | `api/webhooks/[channel]/route.ts` (214 ln), `lib/mediasync/webhook-events.ts` | Prototype only | Working single-node; synchronous inline processing, Meta payloads get no event-level dedupe key | Rewrite the processing model on main's store-then-process pipeline (atomic claim, retry, dead-letter); keep the verification/normalization steps | High | Slice 5 |
| Inbound ingestion — manual/simulator path | Slice 1 | `src/lib/services/conversation-simulator.ts` (deterministic, constraint-deduped, exact-email linking, tombstone-safe) | Implemented | Working, integration + e2e tested | Live-channel path still to be rewritten for Slice 5 | — | Slice 5 (live adapters on the store-then-process pattern) |
| Inbound ingestion — live (`ingestInbound`: match → conversation reuse → message append) | `msync`+`legacy` | `lib/services/ingestion.ts` (tested) | Prototype only | Working; **matcher conflicts with main's exact-match ladder** (uses socialHandles JSON, ignores erasure tombstones) | Rewrite against `src/lib/events/matching.ts` + new `CustomerIdentity` rung | High | Slice 5 |
| Message normalization (per channel → `NormalizedInbound`) | `msync` | connectors + `connectors.test.ts` | Prototype only | Working, tested | Port with connectors | Low | Slice 5 |
| Consent management (opt-in/out, STOP/START keywords) | `msync` | `Consent` model, `lib/mediasync/{consent,consent-keywords}.ts` (tested) | Prototype only | Working | Port and adapt; fits main's GDPR posture | Low | Slice 5 (before any outbound send) |
| Message templates | `msync` | `MessageTemplate` model, `templates{,-render}.ts` (tested), settings CRUD | Implemented but incomplete (in prototype: composer never uses templates; `Message.templateId` never written) | Partial | Port render + model later; wire into composer as part of outbound compliance (WhatsApp template rules) | Medium | Backlog |
| Delivery status tracking | `msync` | `Message.status` + `lib/mediasync/delivery.ts` (monotonic `shouldAdvance`, tested), per-message status icons | Prototype only | Working | Port with connectors | Low | Slice 5 |
| Human takeover / release-to-AI | `msync` | `Conversation.handling`, `lib/mediasync/takeover.ts`, `mediasync-panel.tsx` | Prototype only | Working | Port and adapt in the AI slice | Low | Slice 4 |
| Customer-context sidebar for conversations | `legacy` | `lib/services/conversation-context.ts`, `components/cockpit/conversation-context-panel.tsx` | Prototype only | Working, deliberately vertical-agnostic | Reference for Slice 2 rebuild on main's Customer/Opportunity/Task/Activity | Low | Slice 2 |
| Provider-thread threading, unread state, attachments persistence, realtime updates | — | Nowhere (threading is “latest open conversation per customer+channel”; attachments dropped; no unread flags; `revalidatePath` only) | Missing | — | Design in target architecture; attachments and unread in Slice 1 schema, realtime later | Medium | Slices 1/5 |

## 2. Workflows (internal engine heritage: opsync)

| Capability | Source | Location | Status | Maturity | Reuse recommendation | Migration risk | Next action |
|---|---|---|---|---|---|---|---|
| Tasks (CRUD, filters, priority, due dates, record-level access) | `main` | `src/lib/services/tasks.ts`, `(app)/tasks/*` | Implemented | Working, audited; no unit tests | **Extend, never replace**: add `conversationId` link, richer statuses (additive), unit tests | Low | Slice 3 |
| SLA follow-up auto-task | `main` | `events/handlers.ts:376-412` | Implemented | Working | Keep; later generalize into rules | Low | — |
| Opportunity stage transitions + assignment | `main` | `services/opportunities.ts` | Implemented | Working; free transitions, no state machine | Keep; workflow engine may later constrain transitions | Low | — |
| Audit log | `main` | `src/lib/audit.ts`, `AuditEvent`, `/audit` UI | Implemented | Production-hardened | Canonical. Prototype `AuditLog` models are **Obsolete** | — | Extend event types per slice |
| Approvals — generic entity gate | `msync` | `ApprovalRequest` model, `services/approvals.ts` + `approval-effects.ts`, `/approvals` UI | Prototype only | Working; only 2 effect types; idempotency by pre-query not constraint | Port and adapt as the single approval surface | Medium | Slice 4 (AI actions) then business actions |
| Approvals — AI tool-invocation gate | `legacy` | `lib/tools/runtime.ts` (atomic claim, 48h TTL, edit-before-approve; unit-tested) | Prototype only | Working, well-tested | Port the runtime; **unify with the entity gate** — one ApprovalRequest model, two request sources. The two prototype gates are **Duplicate** concepts | Medium | Slice 4 |
| Workflow definitions / steps / instances / transitions | `msync` + `spec:WORKFLOW_ENGINE.md` | `workflow-eval.ts` (pure, tested), `services/workflow.ts`, `workflow-card.tsx` | Prototype only | Partial: no authoring UI, `allowedActions` not executable, `autoAdvance` dead | Cherry-pick `workflow-eval.ts`; port service later when a real use case lands | Medium | Backlog (after Slice 3) |
| Business rules engine | `msync` | `business-rules.ts` (tested), settings UI | Prototype only | Working; naive substring region match | Defer with quoting decision (§6 open questions) | Low | Requires manual review |
| Automations (trigger/condition/action) | `legacy`+`msync` | `lib/services/automations.ts`, `automations/schema.ts` (tested) | Prototype only | Working; no send_message action (correctly) | Port after Conversations stabilize | Medium | Backlog |
| SOPs (draft→approve→version, AI generation) | `legacy` | `lib/services/sops.ts`, `components/sops/*` | Prototype only | Working | Port later; low urgency | Low | Backlog |
| Escalations (rules, time-based) | `spec` only (task docs, WORKFLOW_ENGINE.md mentions) | — | Missing | — | Design with reminders/notifications | — | Backlog |
| Reminders / notifications (due tasks, mentions) | — | Nowhere (overdue is a filter + red text) | Missing | — | Needs a notification channel decision (in-app/email) | — | Backlog |
| Task dependencies, recurrence, checklists | — | — | Missing | — | Only on demonstrated need | — | — |

## 3. Intelligence (internal engine heritage: synco)

| Capability | Source | Location | Status | Maturity | Reuse recommendation | Migration risk | Next action |
|---|---|---|---|---|---|---|---|
| AI provider abstraction + Anthropic adapter (forced tool-use structured output) | `legacy` (extended on `msync`) | `lib/ai/{provider,anthropic,config,service}.ts`; `service.test.ts` | Prototype only | Working, tested; stale hard-coded model ids; mock mode built in | Port and adapt: main's ctx/RBAC (`ai:run`), current model ids, env in `.env.example` | Low–medium | Slice 4 |
| `AIAction` audit trail (model, prompt version, trimmed input, output, confidence, status) | `legacy` | schema + `lib/ai/service.ts` (PII-minimising `trimInput`) | Prototype only | Working; good privacy pattern | Port with AI layer | Low | Slice 4 |
| AI task registry (10 tasks: summarize, classify, draft reply w/ risk, SOP gen, content gen, insights, extract requirements, request info, draft quote, extract document) | `legacy`+`msync` | `lib/ai/tasks.ts` (27 KB), each with Zod schema + deterministic mock + shared guardrails | Prototype only | Working | Port selectively: summarize/classify/draftReply first; commerce tasks await §6 decision | Low | Slice 4 |
| Typed tool runtime (deny-by-default approval, idempotency keys, atomic execution claim, audited) | `legacy` | `lib/tools/{types,policy,registry,runtime}.ts` + tests; flagged in ARCHIVE.md as worth re-transplanting | Prototype only | Working, best-tested prototype module | Port and adapt — this is the deterministic gateway the AI layer must go through | Medium | Slice 4 |
| Assistant threads + streaming turn generator + 18 cockpit card renderers | `legacy` | `lib/services/assistant.ts`, `components/cockpit/*`, NDJSON stream route | Prototype only | Working (chunked, not token streaming) | Port later; not needed for Slice 4 MVP (contextual assistance first, cockpit later) | Medium | Backlog |
| Intent detection / sentiment / lead score | `legacy` | `classifyConversation` task + enums | Prototype only | Working (mock+live) | Port with AI layer; persist on Conversation | Low | Slice 4 |
| Conversation summarisation | `legacy` | `summarizeConversation` task | Prototype only | Working | Port | Low | Slice 4 |
| Suggested replies with risk + confidence, human accept/edit | `legacy`+`msync` | `draftReply` task + `reply-composer.tsx` (risk badge, “review before sending” banner) | Prototype only | Working | Port; keep the never-auto-send invariant | Low | Slice 4 |
| Confidence thresholds that *gate behaviour* | — | Nowhere: confidence is stored/displayed, never branched on; `aiAutoReplyEnabled` is a dead flag | Missing | — | Implement as explicit policy in the tool gateway (see target architecture) | — | Slice 4 |
| Routing / escalation recommendations, next-best-action | `spec` (BLUEPRINT §10) | partial: `recommendedNextAction` field in summarize output | Specification only | — | Build on stable Conversations + Workflows | — | Backlog |
| Outcome learning | `spec` | — | Missing | — | Defer | — | Backlog |
| Analytics / manager insights | `legacy` | `lib/services/analytics.ts`, Recharts UI, `managerInsights` task | Prototype only | Working | Port later; dashboard counters on main suffice near-term | Low | Backlog |
| Prompt-injection defence + guardrails blocks | `legacy` | `GROUNDING`/`GUARDRAILS` strings in `ai/{tasks,assistant-tasks}.ts` | Prototype only | Good baseline | Port verbatim with AI layer | Low | Slice 4 |

## 4. Growth (internal engine heritage: brandforge)

| Capability | Source | Location | Status | Maturity | Reuse recommendation | Migration risk | Next action |
|---|---|---|---|---|---|---|---|
| Brand voice / profile | `legacy` | `BrandVoice` model, `brand-voices.ts`, `brand-voice-manager.tsx` (233 ln) | Prototype only | Working | Port in Growth slice; extend toward full brand profile | Low | Slice 6 |
| Content drafts + studio (generate from conversation/insight) | `legacy` | `lib/services/content.ts` (231 ln), `studio/*` | Prototype only | Working | Port in Growth slice | Low | Slice 6 |
| Campaigns, content calendar, scheduled publishing | — | Only `queue_social_post` tool + mock social adapter (`verticals/real-estate/social-adapter.ts`) | Missing (publishing), Prototype only (queue mock) | — | Design Campaign model in Growth slice; real publishing needs channel decision | — | Slice 6 |
| Multilingual content | `legacy` | `translateMessage` task (mock passthrough at 0.2 confidence in mock mode) | Prototype only | Partial | Port with AI layer | Low | Backlog |
| Performance attribution (campaign → conversations → outcomes) | `spec` | — | Missing | — | Requires Conversations + Growth linkage; design only | — | Slice 6+ |
| Audience definitions, lead reactivation | `spec` | — (`search_conversations` supports `notContactedForDays` — a building block) | Missing | — | Defer | — | Backlog |

## 5. Cross-cutting platform (canonical on main)

| Capability | Source | Status | Notes |
|---|---|---|---|
| Tenancy: Organisation / Membership / 3-role RBAC / invitations / 2FA / session revocation | `main` | Implemented (production-hardened) | Canonical. Prototype `Workspace`/`WorkspaceMember`/6-role matrix is **Obsolete** — every ported service must be rewritten onto `OrgContext` + `requirePermission`. Role-model expansion is an open question (§6). |
| Customer model + exact-match identity ladder + erasure tombstones | `main` | Implemented | Canonical (`src/lib/events/matching.ts`, 10 unit tests). Prototype matchers are **Obsolete**. `CustomerIdentity` channel-handle rung delivered in Slice 2 (taught by linking, deleted on erasure). |
| Privacy lifecycle (erasure across surfaces, restriction, payload retention) | `main` | Implemented | Every new model (Conversation, Message, attachments, AIAction) must join `eraseCustomer` and retention. `msync` `Workspace.dataRetentionDays` is a dead flag — **Obsolete**. |
| Signed domain-event ingestion (store → atomic claim → retry → dead-letter) | `main` | Implemented | The architectural template for channel webhook processing (replaces prototype's synchronous inline model). |
| Rate limiting (Upstash, fail-closed), encryption (AES-256-GCM under `OPERANTO_ENCRYPTION_KEY`), observability (Sentry + scrubbing) | `main` | Implemented | Canonical. `msync` in-process Map limiter and `mediasync/crypto.ts` (falls back to `AUTH_SECRET` — rotation bricks credentials) are **Obsolete**. |
| Catalogue / quoting / appointments+ICS / document AI / HubSpot push (msync phases B,C,F,G,H) | `msync` | Requires manual review | Working prototypes of a commerce/ops suite. Whether they are in Operanto's near-term product scope is a product decision, not an engineering one (§6). Pure helpers (`quote-totals.ts`, `ics.ts`) are cherry-pickable whenever needed. |
| Demo seed data (2–3 workspaces, message threads, pending approvals) | `legacy`+`msync` | Prototype only | Retain as reference for future demo fixtures; do not port (fs side effects, `operanto` password, wrong tenancy). |

---

## 6. Product-owner decisions (approved 2026-08-01)

The questions raised by this audit were decided as follows. The backlog (§7)
and `docs/operanto-target-architecture.md` reflect these decisions.

1. **Scope — conversations-first.** Quoting, catalogue, business rules,
   appointments, document AI, and other commerce-specific prototype
   functionality are **not** ported during the foundation slices. They
   remain future vertical capabilities (Nagelista, Pronatona, and other
   adapters).
2. **Channels.** Slice 1 uses manual input plus a deterministic simulator.
   A controlled web-chat channel may follow. The first major live external
   connector is the **WhatsApp Cloud API**. Telegram is not currently a
   priority.
3. **Meta architecture.** One Operanto-managed Meta application; every
   Operanto organisation connects its own WhatsApp Business Account and
   phone number. Adapter extensibility for BSP providers is preserved.
4. **Roles.** The current three-role Organisation/Membership model stays.
   Granular permissions, assignment rules, and approval states are
   implemented within it. Reviewer or client-viewer roles are added only
   when justified by a real use case.
5. **Outbound controls.** Operanto enforces consent state, applicable
   template and messaging-window policies, approvals, auditability, and
   safe failure behaviour. Compliance policy is configurable per channel
   and per tenant.
6. **AI.** The provider abstraction is retained; deterministic mock mode
   remains the default for tests and staging. **OpenAI is the initial
   production provider** for summarisation, classification, and draft
   replies — domain code never couples to it directly. Tenant-level model
   selection, usage limits, and budget controls are required. Other
   providers can be added behind the same abstraction.
7. **Prototype branch.** `origin/mediasync-communication-layer` is not
   altered or deleted during the audit or early implementation work. After
   all approved reusable components have been transplanted, an immutable
   archive tag plus remote-branch deletion will be proposed as a separate
   action.
8. **Growth stays Slice 6.** BrandProfile, campaign generation, and
   publishing are not pulled ahead of the Conversations, Customer Context,
   Workflow, AI Handover, and Channel Adapter foundations.
9. **Retention.** Configurable per organisation; **12 months is the
   provisional default for message payloads**, with restriction and
   erasure requirements taking precedence. Longer-lived audit records
   carry minimal non-content metadata, never full message bodies. The
   production policy requires contractual and legal confirmation.
10. **Opportunity model.** The naming/domain collision is resolved
    explicitly in the target architecture: the existing `Opportunity`
    model remains the Pronatona real-estate projection; a general
    commercial pipeline, if and when built, is a separate bounded model.
    Incompatible model shapes are never merged under one generic entity.

## 7. Recommended backlog (vertical slices, in order)

| # | Branch | Scope | Depends on |
|---|---|---|---|
| 0 | `audit/operanto-capability-gap` | This audit + target architecture. Docs only. | — |
| 1 ✅ | `feature/operanto-conversations-foundation` (delivered 2026-08-01) | Conversation/Message/ConversationNote/ChannelConnection models (additive migration), `conversations:*` permissions, erasure extension, manual entry + simulator channel, list/detail UI, assignment/status/notes, audit + Activity events, unit + integration + e2e tests. | 0 |
| 2 ✅ | `feature/operanto-customer-context` (delivered 2026-08-02) | `CustomerIdentity` (channel handles as a new ladder rung, taught by linking), contextual sidebar (timeline, opportunities, tasks, prior conversations), matching tests. See `docs/operanto-customer-context.md`. | 1 |
| 3 ✅ | `feature/operanto-conversation-workflows` (delivered 2026-08-02) | Task↔Conversation link (additive), create-task-from-conversation, task progress in conversation timeline and customer context. See `docs/operanto-conversation-workflows.md`. | 1 |
| 4 ✅ | `feature/operanto-ai-handover` (delivered 2026-08-02) | Provider-neutral AI layer (mock default, OpenAI adapter), summary/classification/draft/next-action with server-side confidence+risk policy, unified ApprovalRequest with atomic decisions, human takeover/release, tenant AI config with budget controls, tool runtime foundation, privacy integration. See `docs/operanto-ai-handover.md`. | 1–3 |
| 5 | `feature/operanto-channel-adapters` | Channel adapter interface, WebhookEvent store + async processing on the InboundEvent pattern, consent + delivery status, WhatsApp Cloud API connector behind a feature flag (decisions 2–3), optional controlled web-chat channel. | 1, 4 (for AI-assisted replies) |
| 6 | `feature/operanto-growth-foundation` | BrandProfile/BrandVoice, content drafts, campaign model, approval + linkage to conversations/opportunities. | 1–5 stable |

Do not open navigation entries for a capability before its slice ships usable
functionality (no empty pages). Intelligence surfaces contextually inside
Conversations/Customers/Tasks — no separate nav item initially.

## 8. Security and privacy findings to carry into implementation

From the prototype review — these must NOT be ported as-is:

1. **Cross-tenant webhook routing** (`msync` route falls back to a
   workspace-unfiltered `findFirst` when a connector cannot resolve the
   account — Telegram always hits this).
2. **Tenant-unscoped idempotency**: `IntegrationAction @@unique([provider,
   idempotencyKey])` allows cross-tenant collisions; `Message` dedupe uses a
   non-unique index (read-then-write race).
3. **Global provider secrets**: inbound signature verification always uses
   process-level env secrets; per-tenant credentials exist only for sending.
4. **Credential-encryption fallback to `AUTH_SECRET`** (`msync
   lib/mediasync/crypto.ts`) — rotating the auth secret silently bricks
   stored channel tokens. Use main's `OPERANTO_ENCRYPTION_KEY` crypto only.
5. **Public widget route** with no auth beyond an unguessable id, no
   turnstile, in-process rate limiting.
6. **Demo credentials in source** (`login/page.tsx` prefills seeded
   passwords; universal password `operanto` in seeds).
7. **Synchronous webhook ingestion** (identity resolution, writes, and
   automation execution inline in the request) — no queue, no backpressure.
8. **No enforcement of confidence thresholds or auto-reply gates** — the
   “human approves” invariant currently holds only because no auto-send code
   path exists. The target architecture makes it an enforced policy.
9. **Prototypes predate the privacy lifecycle** — none of their models handle
   erasure, restriction, or retention; every ported model must be added to
   `eraseCustomer`'s surface list and tested.
10. **Prototypes have no invitations, no 2FA, no session revocation, no
    Sentry scrubbing** — ported UI/services must run under main's auth stack
    exclusively.
