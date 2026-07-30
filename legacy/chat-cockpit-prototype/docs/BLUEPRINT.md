# Operanto — Product & Technical Blueprint

> **Where conversations become operations.**
> The AI operating layer for conversation-driven businesses.

Version 0.1 · Living document · Last updated 2026-05-25

---

## 1. Executive summary

Operanto is an AI business **execution** platform — not a CRM, not a helpdesk, not a social scheduler. It unifies customer messages (Instagram, Facebook, WhatsApp, email, SMS, web chat), internal operations (SOPs, tasks, QA, onboarding), AI content creation, and an optional human-agent layer into one chat-first command center.

The product thesis is a single sentence: **a conversation is not just a message — it is a latent operation** (a lead, a task, a quote, an SOP improvement, a content idea). Operanto's job is to detect that latent operation and help a human execute it fast and consistently.

The MVP proves this loop end-to-end for **one vertical** (beauty/aesthetics + boutique ecommerce selling via Instagram/WhatsApp) with a manual/demo channel, then expands.

**Non-goals for MVP:** real-time multi-channel API ingestion at scale, billing, the human-agent marketplace, advanced automation DAGs, vector search. All are architected-for but not built.

---

## 2. Product vision

A user opens Operanto and sees a **command bar + prioritized work**, not a wall of menus. They type "draft replies for today's pricing questions" or click an AI-suggested action on a conversation. Every AI output is a *suggestion a human approves* — Operanto never auto-sends customer messages by default. Over time the system learns the business's brand voice, SOPs, and recurring patterns, and proactively surfaces insights ("18 leads went un-replied >24h", "create a shipping-policy post").

The experience target: **ChatGPT + unified inbox + ops dashboard**, with the polish of Linear/Front/Superhuman.

---

## 3. MVP definition

**In scope (Phases 0–6):**

| Module | MVP capability |
|---|---|
| Workspace & Auth | Multi-tenant workspaces, users, roles, members, settings |
| Inbox | Conversations list, thread, customer profile, tags, assignment, status, priority, internal notes, manual/demo channel seeded |
| AI Assistant | Summarize, classify intent, detect sentiment, lead-score, draft reply, suggest next action — all logged with confidence |
| Tasks | Create from conversation, assign, due date, priority, status, links |
| SOPs | Library, editor, AI generator, categories, approval status, simple versioning |
| Studio | Brand voice, generate content from conversations/insights, drafts, status board |
| Intelligence | Core metrics, top intents, response time, lead count, recurring questions, AI insights |

**Architected but mocked:** real channel connectors (Meta/WhatsApp/Gmail/Twilio), Automations rule engine (Phase 7), Assist human layer, billing, pgvector semantic search.

**Definition of done for MVP:** a seeded workspace where a demo Instagram DM flows → AI classifies + scores + drafts → agent edits/sends → follow-up task created → insight updates → content idea generated from recurring questions. All multi-tenant-safe and auditable.

---

## 4. Target users (personas)

1. **Lana — Salon owner (primary).** Runs a 4-person aesthetics studio. Sells through Instagram DMs + WhatsApp. Drowning in "how much?" messages, forgets follow-ups. Wants fast, on-brand replies and to never miss a lead. *Success = faster replies, fewer missed leads.*
2. **Marko — Ops manager at a 12-person support BPO.** Needs SOPs followed, QA scores, onboarding, performance visibility across agents and client brands. *Success = consistent execution + manager visibility.*
3. **Elira — Boutique ecommerce founder.** Photo-driven custom orders; customer intent arrives as vague messages + images. Needs to convert messages into structured quotes/orders and reuse FAQs as content. *Success = message → structured commercial workflow.*
4. **Driton — Agency operator (later).** Manages communication for many client brands; needs multi-tenant workspaces, brand voice per client, QA, weekly reports, optional Kosovo-based agents. *Success = scalable managed-service ops.*

---

## 5. Core modules

- **Operanto Inbox** — unified communication center.
- **Operanto Ops** — SOPs, onboarding, tasks, workflows, compliance.
- **Operanto Studio** — AI content + brand voice engine.
- **Operanto Assist** — optional human-agent execution layer (post-MVP).
- **Operanto Intelligence** — analytics + AI insights.
- **Operanto Automations** — trigger/action rule engine (Phase 7).

All bound by a **Command** surface (AI command bar) that can drive most actions via natural language.

---

## 6. Key user journeys

1. **DM → lead.** Message arrives → customer upserted → AI intent=`pricing_inquiry`, lead_score=82 → AI drafts reply → agent edits & sends → follow-up task auto-created → pricing-questions insight increments.
2. **Conversation → content.** Recurring "delivery time?" detected → Intelligence raises a `content_opportunity` insight → user clicks "Create post" → Studio generates caption + FAQ + email snippet → user edits & saves draft.
3. **Manager → SOP.** "Create an SOP for angry refund requests" → AI generates structured SOP → manager edits & approves → available to agents → future refund convos link it.
4. **Performance review.** Manager opens Intelligence → sees slow agent → opens QA review → AI summarizes weak points → assigns training SOP → schedules follow-up.
5. **Human-assisted (post-MVP).** Client connects channels → Kosovo agent assigned → works from brand voice + SOPs → manager QA → client gets weekly report.

---

## 7. System architecture

**Decision: Option A — full-stack Next.js (App Router).** Fastest path to a credible MVP; can extract services later behind the existing service layer. Rationale in §17.

```
┌─────────────────────────────────────────────────────────────┐
│ Next.js App Router (React 19 + TS + Tailwind + shadcn/ui)    │
│  Command bar · Inbox · Tasks · SOPs · Studio · Intelligence  │
│  Client state: TanStack Query (server) + Zustand (UI/local)  │
└───────────────┬──────────────────────────┬──────────────────┘
                │ Server Actions / Route    │
                │ Handlers (typed)          │
┌───────────────▼──────────────────────────▼──────────────────┐
│ Application layer (lib/)                                      │
│  auth + workspace context · RBAC guards · Zod validation     │
│  domain services (conversation, task, sop, content, insight) │
│  AI service layer (provider-agnostic) · prompt registry      │
│  connector abstraction (channels) — mocked in MVP            │
│  audit log · AIAction log                                    │
└───────────────┬──────────────────────────┬──────────────────┘
                │ Prisma                    │ provider SDK
┌───────────────▼──────────┐   ┌────────────▼──────────────────┐
│ PostgreSQL (multi-tenant) │   │ AI provider (Anthropic/OpenAI)│
│  workspace_id on every    │   │  via AIProvider interface     │
│  tenant-scoped row        │   │  structured JSON output       │
└───────────────────────────┘   └───────────────────────────────┘

Deferred: Redis + BullMQ (jobs), pgvector (semantic), real connectors,
Meta/WhatsApp/Gmail/Twilio webhooks, Stripe billing.
```

**Principles:** every tenant-scoped query goes through a workspace-scoped Prisma helper; no raw queries in UI; AI calls only through the service layer; prompts only in the registry; all AI/important mutations write audit rows.

---

## 8. Recommended stack

- **Frontend:** Next.js (App Router), TypeScript, React, Tailwind, shadcn/ui, TanStack Query, Zustand, React Hook Form + Zod, Recharts.
- **Backend:** Next.js Server Actions + Route Handlers, Prisma, PostgreSQL.
- **Auth:** Auth.js (Credentials + email for MVP; OAuth-ready). Workspace membership layered on top.
- **AI:** Provider-agnostic `AIProvider` interface; default Anthropic (`claude-opus-4-7` for high-stakes generation, `claude-haiku-4-5` for classification/cheap calls). Structured outputs validated with Zod.
- **Tooling:** pnpm, ESLint, Prettier, Vitest, Playwright (later), Docker Compose for Postgres.
- **Deferred:** Redis/BullMQ, pgvector, Stripe.

---

## 9. Data model (Prisma-oriented)

Every tenant-scoped table carries `workspaceId` and is indexed on it. Enums are Prisma enums. Soft-delete via `deletedAt` on high-value entities.

**Core:** `Organization`/`Workspace` (slug, plan, timezone, defaultLanguage), `User`, `WorkspaceMember` (workspaceId, userId, role, status).

**Channels & people:** `ChannelAccount` (type enum, encrypted tokens, status, metadata), `Customer` (name, email, phone, socialHandles JSON, language, location, notes).

**Inbox:** `Conversation` (customerId, channelAccountId, channelType, status enum, priority enum, assignedToUserId, lastMessageAt/lastInboundAt/lastOutboundAt, sentiment, intent, leadScore, summary), `Message` (direction, senderType, senderUserId, externalMessageId, body, attachments JSON, metadata), `InternalNote`, `Tag`, `ConversationTag`.

**Ops:** `Task` (status enum, priority, assignedToUserId, createdByUserId, dueAt, linkedConversationId, linkedCustomerId, linkedSopId), `SOP` (title, body, category, status enum, version, createdBy, approvedBy).

**Content:** `BrandVoice` (tone, language, dos, donts, examplePhrases), `ContentDraft` (channel enum, content, status enum, brandVoiceId, sourceConversationId, sourceInsightId, scheduledAt).

**AI & analytics:** `AIAction` (actionType, inputContext, promptTemplate, model, output, confidence, status), `Insight` (type enum, title, description, sourceData JSON, priority, status), `QAReview` (conversationId, agentUserId, reviewerUserId, score, criteriaScores JSON, comments).

**Cross-cutting:** `AuditLog` (workspaceId, actorUserId, action, entity, entityId, before/after JSON, createdAt).

Enums match §8 of the master spec (statuses, priorities, intents, sentiments, channel types). Full schema lands in `prisma/schema.prisma` in Phase 1.

---

## 10. AI architecture

```
callerService → AIService.run(task, context)
  → PromptRegistry.get(task)            (versioned templates, no inline prompts)
  → ModelRouter.pick(task)              (haiku for classify, opus for generate)
  → AIProvider.complete({system,messages,schema})   (Anthropic default)
  → ResponseParser.parse(schema)        (Zod-validated structured JSON)
  → AIActionLog.write(...)              (input, model, output, confidence, status)
  → return {data, confidence, reasoning, risk}
```

- **Provider-agnostic interface** so OpenAI/local models drop in later.
- **Structured outputs only** — every AI task declares a Zod schema; parse failures retry once then surface gracefully.
- **Tasks:** `summarizeConversation`, `classifyIntent`, `detectSentiment`, `scoreLead`, `draftReply`, `suggestNextAction`, `generateSOP`, `generateContent`, `managerInsights`.
- **Safety (hard rules):** AI suggests, human approves; never auto-send customer messages unless explicitly enabled per channel; every action logged with confidence + reasoning; risky/low-confidence outputs flagged; AI must not invent policy — it asks for missing info; all AI text is editable before use.

**Prompt template skeleton (every task):** role + business context (workspace, brand voice, SOPs) → task instructions → input data → required JSON schema → guardrails ("do not invent policy; if unknown, say so").

---

## 11. UX architecture

- **Layout:** left module sidebar · central workspace · right contextual panel · persistent AI command bar · top workspace switcher + global search.
- **Nav:** Command · Inbox · Tasks · SOPs · Studio · Intelligence · Automations · Team · Settings — but most actions reachable via command bar.
- **Inbox-first feel:** conversation thread center, customer + AI panel right, contextual actions inline (Summarize, Draft, Create task, Link SOP).
- **Tone:** calm, premium, fast, uncluttered; strong type, soft cards, generous spacing; minimal color. Inspirations: Linear, Front, Superhuman, Intercom, Notion.
- **Component architecture:** shadcn/ui primitives → composed domain components (`ConversationCard`, `MessageThread`, `CustomerPanel`, `AIDraftPanel`, `TaskCard`, `SOPEditor`, `ContentCard`, `MetricCard`, `CommandBar`). No business logic in components — they consume hooks/services.

---

## 12. Security & permissions model

- **Roles:** owner, admin, manager, agent, reviewer, client_viewer.
- **RBAC matrix** enforced server-side on every mutation (a `requirePermission(member, action, resource)` guard). UI hides what it shouldn't show, but the server is the source of truth.
- **Multi-tenancy:** `withWorkspace(userId)` resolves the active membership; all tenant queries go through a scoped client that injects `workspaceId`. Cross-workspace access is impossible by construction, not by convention.
- **Secrets:** channel tokens encrypted at rest (AES-GCM via a server-only key); never returned to client.
- **Audit:** every AI action + sensitive mutation (status change, assignment, SOP approval, send) writes an `AuditLog` row.
- **AI-in-the-loop:** approvals required for outbound; confidence + risk surfaced.

| | owner | admin | manager | agent | reviewer | client_viewer |
|---|---|---|---|---|---|---|
| Workspace settings | ✓ | ✓ | – | – | – | – |
| Manage members/roles | ✓ | ✓ | – | – | – | – |
| Connect channels | ✓ | ✓ | ✓ | – | – | – |
| Read/reply conversations | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Send outbound | ✓ | ✓ | ✓ | ✓ | – | – |
| Assign/triage | ✓ | ✓ | ✓ | ✓ | – | – |
| Create/approve SOP | ✓ | ✓ | ✓ (create) | – | – | – |
| QA review | ✓ | ✓ | ✓ | – | ✓ | – |
| View reports | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (scoped) |

---

## 13. Integrations strategy

- **Connector abstraction first:** `Channel` interface (`fetchMessages`, `sendMessage`, `verifyWebhook`, `normalize`) with a `ManualConnector`/`DemoConnector` implemented for MVP and real connectors stubbed.
- **Order of real integration (Phase 8):** Email (Gmail) → Meta/Facebook → Instagram → WhatsApp Cloud → web chat widget → SMS (Twilio). Slack/Teams, Zapier/Make later.
- **Webhook-ready:** route handlers + signature verification scaffolded; messages normalized into the unified `Message` shape regardless of source.

---

## 14. Development roadmap

| Phase | Deliverable |
|---|---|
| 0 | Blueprint (this doc), schema, route/UI map, backlog, decisions |
| 1 | App shell: Next.js, auth, workspace model, sidebar layout, RBAC nav, seed data |
| 2 | Inbox MVP: list, thread, customer profile, tags, assignment, status, notes, demo channel |
| 3 | AI layer: provider abstraction, summarize/classify/draft/next-action, AIAction logs, UI actions |
| 4 | Tasks + SOPs: task system, create-from-conversation, SOP library/editor/AI generator, links |
| 5 | Studio: brand voice, generate-from-conversation, drafts, status board |
| 6 | Intelligence: metrics, top intents, response time, leads, recurring questions, AI insights |
| 7 | Automations: simple trigger/action rule engine |
| 8 | Real connectors, incrementally |

---

## 15. Sprint 1 backlog (Phase 0 → Phase 1)

**Goal:** a running, seeded, multi-tenant Next.js app with auth, workspace context, RBAC-aware shell, and the data model in Postgres.

1. Scaffold Next.js + TS + Tailwind + shadcn/ui; pnpm; lint/format; Docker Compose Postgres.
2. `prisma/schema.prisma` with full core model (§9) + enums; migrate.
3. Auth.js (credentials) + `User`/`WorkspaceMember`; session → active workspace resolution.
4. `withWorkspace` scoped Prisma helper + `requirePermission` RBAC guard.
5. App shell: sidebar nav, top workspace switcher, command-bar placeholder, right panel slot; route stubs for all modules.
6. Seed script: 1 org, 2 workspaces (salon + ecommerce), users for each role, customers, conversations + messages (demo channel), tags, a couple SOPs, a brand voice, sample insights — realistic content for the chosen niche.
7. Login → workspace select → command center shell rendering seeded priority conversations + open tasks.

**Sprint 1 done =** clone, `pnpm i`, `docker compose up`, `pnpm db:push && pnpm db:seed`, `pnpm dev` → log in → see a populated, tenant-safe command center.

---

## 16. API & route plan

**App routes:** `/login`, `/select-workspace`, `/[workspace]/command`, `/inbox`, `/inbox/[conversationId]`, `/tasks`, `/sops`, `/sops/[id]`, `/studio`, `/intelligence`, `/automations`, `/team`, `/settings/*`.

**Server actions/handlers (tenant-scoped):** conversations (list/get/update-status/assign/tag/note/reply), messages (list/create), tasks (CRUD), sops (CRUD/approve/generate), content (generate/CRUD), brandVoice (CRUD), insights (list), ai (`/api/ai/[task]`), channels (mock connect/list), webhooks (`/api/webhooks/[channel]` — stubbed).

---

## 17. Risks & tradeoffs

- **Full-stack Next.js vs split backend.** Chose Next.js for speed + investor-demoable velocity. Risk: heavy background/AI workloads later. Mitigation: domain logic isolated in `lib/services` so it can extract into NestJS/queue workers without UI rewrites.
- **AI cost & latency.** Mitigation: model router (cheap Haiku for classify/score, Opus for generation), cache classifications, batch where possible, log everything for eval.
- **Scope creep.** The spec is huge. Mitigation: ship the one vertical loop end-to-end before breadth.
- **Channel API approval lead times** (Meta/WhatsApp review). Mitigation: demo/manual connector makes the product fully demoable without approvals.
- **Multi-tenant data leakage** is the existential risk. Mitigation: enforced at the data-access layer, not per-query discipline.
- **Prompt drift / hallucinated policy.** Mitigation: prompt registry versioning, "don't invent policy" guardrail, human approval, confidence flags.

---

## 18. Assumptions

1. Launch niche = beauty/aesthetics + boutique ecommerce on Instagram/WhatsApp (seed data tuned for this).
2. Anthropic is the default AI provider; abstraction keeps OpenAI/local optional.
3. English + Albanian as first languages (multilingual-ready).
4. Single Postgres, no microservices, for MVP.
5. No billing/Stripe in MVP.
6. Human-Assist layer is architected (roles, QA, reports) but not operationally built in MVP.
