# Operanto

> Where conversations become operations.

An AI-powered operating layer for conversation-driven businesses — unified inbox,
operations/SOPs, AI content, and analytics in one chat-first command center.

See [docs/BLUEPRINT.md](docs/BLUEPRINT.md) for the full product & technical blueprint.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 6 · PostgreSQL ·
Auth.js v5 · TanStack Query · Zustand · Zod · Recharts · Anthropic (AI, configurable).

## Getting started

Requirements: Node 20+, pnpm, Docker.

```bash
pnpm install
cp .env.example .env          # already created on first setup
pnpm db:up                    # start Postgres (Docker, host port 5433)
pnpm db:push                  # create the schema
pnpm db:seed                  # load demo data (2 workspaces)
pnpm dev                      # http://localhost:3000
```

> Note: the Docker Postgres is mapped to host port **5433** to avoid clashing with a
> local Postgres on 5432. Change in `docker-compose.yml` + `.env` if needed.

> **Node ≥ 20.12** is required to run the test suite (Vitest 4). The app itself
> runs on 20.6+. The assistant works with **no API key** (deterministic mock mode).

### Demo accounts (password `operanto`)

| Email | Workspace | Vertical | Role |
|---|---|---|---|
| `ardit@pronatona.test` | Pronatona (real estate, Kosovo) | real-estate | owner |
| `endrit@pronatona.test` | Pronatona | real-estate | agent |
| `rea@pronatona.test` | Pronatona | real-estate | reviewer |
| `lana@bloomstudio.test` | Bloom Studio (beauty/aesthetics) | generic | owner |
| `driton@bloomstudio.test` | Bloom Studio | generic | agent |
| `elira@lumeagoods.test` | Lumea Goods (boutique ecommerce) | generic | owner |

Sign in as **`ardit@pronatona.test`** for the full chat cockpit.

### Chat cockpit

A chat-first operational layer: an internal AI **Assistant** that turns
natural-language commands into typed, permission-controlled **tools**, renders
results as rich **cards**, and routes sensitive actions through an **approval**
queue — over structured records (contacts, conversations, opportunities,
properties) and real workflows. Real-estate lives in an isolated vertical
(`src/verticals/real-estate`); the core is vertical-agnostic.

See `docs/chat-cockpit-architecture.md`, `docs/ai-tool-execution.md`,
`docs/approval-workflows.md`, `docs/pronatona-real-estate-vertical.md`, and
`docs/chat-cockpit-demo.md`.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the app |
| `pnpm build` | Production build |
| `pnpm db:up` | Start Postgres (Docker) |
| `pnpm db:push` | Sync Prisma schema to the DB |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:reset` | Force-reset schema + reseed |
| `pnpm db:studio` | Open Prisma Studio |

## Architecture notes

- **Multi-tenancy** is enforced at the data layer: `src/lib/workspace.ts` resolves the
  caller's membership and `scope(ctx)` injects `workspaceId` into every query. A user
  who is not a member of a workspace is redirected away — verified end-to-end.
- **RBAC** lives in `src/lib/rbac.ts` (single permission matrix, server-enforced).
- **AI** will route through a provider-agnostic service layer (Phase 3); prompts live in
  a registry, every AI action is logged with confidence (`AIAction` model).

## Roadmap

Phase 0 (blueprint) ✓ · Phase 1 (app shell + auth + schema + seed) ✓ ·
Phase 2 (Inbox MVP) ✓ · Phase 3 (AI Assistant layer) ✓ · Phase 4 (Tasks + SOPs) ✓ ·
Phase 5 (Content Studio) ✓ · Phase 6 (Intelligence) ✓ · Phase 7 (Automations) ✓ ·
**Phase 8 (Channels & ingestion) ✓** — MVP roadmap complete.

### Channels & ingestion (Phase 8)

A channel connector abstraction (`src/lib/channels/`): a `Channel` interface with a
working **web-chat / manual** connector and stubs for Instagram/Facebook/WhatsApp/
email/SMS (which reject inbound until credentials + signature verification are
wired). Inbound flows through `ingestInbound` (`src/lib/services/ingestion.ts`),
which upserts the customer, finds-or-creates an open conversation, appends the
message, and fires the `conversation_created` + `inbound_message` automations.

- **Public webhook**: `POST /api/webhooks/{channel}` (signature-verified; demo
  channels gated by the unguessable `channelAccountId`).
- **Web-chat widget**: a standalone page at `/widget/{channelAccountId}` — type as a
  customer and a real conversation appears in the inbox (no external approvals).
- **Settings → Channels** lists accounts, status, webhook endpoint, and the widget link.

Check: `NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-ingestion.ts`.

### Automations (Phase 7)

A trigger → condition → action rule engine (`Automation` model). Build rules at
`/[workspace]/automations` (conditions: intent / sentiment / channel / lead-score /
message-contains, AND-ed; actions: add tag, set priority, assign, create follow-up
task). Rules fire automatically when a conversation is **analyzed** by AI
(`conversation_analyzed` trigger), and can be run manually across all conversations
with **Run now**. Actions are idempotent (tag upsert, dedup'd task creation).
Service: `src/lib/services/automations.ts`; config schema:
`src/lib/automations/schema.ts`. Check:
`NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-automations.ts`.

### Intelligence (Phase 6)

Dashboard at `/[workspace]/intelligence`: metric cards (open/resolved, leads, avg
first-response, overdue), Recharts visualizations (top intents, sentiment mix,
14-day message volume), and an agent-workload table — all computed in
`src/lib/services/analytics.ts`. The **`managerInsights`** AI task analyzes the
aggregated metrics and writes `Insight` rows (consumed by the command center and
Studio); re-running replaces the auto-generated set rather than piling up.
Check: `NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-intelligence.ts`.

### Content Studio (Phase 5)

Board at `/[workspace]/studio` (Ideas → Drafts → Review → Approved → Published) with
create/edit dialog, inline status, and delete. **Brand voices** (tone, do's/don'ts,
example phrases) are managed in a dialog and steer generation. The **`generateContent`**
AI task drafts on-brand content (hook, caption, CTA, hashtags, variants) from a prompt,
**from a conversation** (button in the inbox), or **from an insight** (button on the
command center). Services: `src/lib/services/content.ts`, `brand-voices.ts`.
Check: `NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-studio.ts`.

### Tasks & SOPs (Phase 4)

**Tasks** — board at `/[workspace]/tasks` (To do / In progress / Blocked / Done),
create/edit dialog, inline status change, assignee filter, due dates, and
**create-task-from-conversation** in the inbox context panel. Service:
`src/lib/services/tasks.ts`.

**SOPs** — library + editor at `/[workspace]/sops`, draft → approved → archived
workflow (approval gated on `sops:approve`; editing an approved SOP returns it to
draft and bumps the version), and an **AI SOP generator** (`generateSOP` task)
that drafts a structured SOP from a topic. Service: `src/lib/services/sops.ts`.
Check: `NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-ops.ts`.

### AI Assistant (Phase 3)

Provider-agnostic AI under `src/lib/ai/`: an `AIProvider` interface (default
`AnthropicProvider`, forced tool-use for structured output), a model router
(Haiku for classify/score, Opus for generation), a task registry with Zod
schemas + prompts + deterministic mocks (`summarizeConversation`,
`classifyConversation`, `draftReply`), and `runAITask` which validates output and
logs an `AIAction` (model, confidence, status). **Mock mode** activates when
`ANTHROPIC_API_KEY` is empty, so the app is fully usable without credentials.

In the inbox: **Analyze** summarizes + classifies and persists intent/sentiment/
lead-score; **AI draft** fills the composer with a brand-voice reply (with risk +
confidence) for the agent to edit — never auto-sent. Set `ANTHROPIC_API_KEY` in
`.env` to use real models. Check: `NODE_OPTIONS="--require ./scripts/preload.cjs"
pnpm tsx scripts/test-ai.ts`.

### Inbox (Phase 2)

Two-pane inbox at `/[workspace]/inbox`: filterable conversation list (status tabs,
channel, assignee, search) + conversation detail with message thread, reply composer,
status/priority/assignee controls, tag editor, internal notes, and a customer/AI context
panel. All mutations run through `src/lib/services/conversations.ts` (RBAC-enforced,
audit-logged, workspace-scoped). Integration check: `pnpm tsx scripts/test-inbox.ts`
(needs `NODE_OPTIONS="--require ./scripts/preload.cjs"`).
