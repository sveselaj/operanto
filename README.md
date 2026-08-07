# Operanto

[![CI](https://github.com/sveselaj/operanto/actions/workflows/ci.yml/badge.svg)](https://github.com/sveselaj/operanto/actions/workflows/ci.yml)

**Customer operations that remember, continue, and resolve.**

Operanto is a multi-tenant operational cockpit: it receives signed domain
events from source systems (first: [Pronatona](https://pronatona.com), the
real-estate site), maintains customer/opportunity/property projections, and
gives the responsible people one place to see who is asking, about what, where
they came from, what already happened, and what must happen next — with full
audit.

Pronatona remains the **system of record** for properties, leads, and staff.
Operanto stores **operational projections and orchestration state** (see
[docs/data-ownership.md](docs/data-ownership.md)).

## Surfaces

One Next.js app serves three domains (separated by `src/proxy.ts`):

| Domain | Surface |
|---|---|
| `operanto.ai` | Public marketing site (`src/app/(marketing)`) |
| `app.operanto.ai` | Cockpit (`src/app/(app)`) — `/dashboard`, `/conversations`, `/customers`, `/opportunities`, `/tasks`, `/activity`, `/integrations/pronatona`, `/settings/*`, `/audit` |
| `api.operanto.ai` | API (`src/app/api`) — `POST /api/v1/integrations/pronatona/events`, `POST /api/internal/events/retry`, `GET /api/health` |

## Stack

Next.js 16 (App Router, the repo pins a version with breaking changes — read
`node_modules/next/dist/docs/` before writing code, per `AGENTS.md`) · React 19 ·
TypeScript strict · Tailwind v4 · Prisma + PostgreSQL · Auth.js (credentials,
invitation-only) · Zod · Vitest.

## Local development

```sh
docker compose up -d                  # Postgres on localhost:5435
cp .env.example .env                  # then fill AUTH_SECRET, OPERANTO_ENCRYPTION_KEY,
                                      # PRONATONA_WEBHOOK_SECRET, SEED_ADMIN_*
pnpm install
pnpm db:push
pnpm db:seed                          # Pronatona org + admin + integration
pnpm dev                              # http://localhost:3000
```

> Node ≥ 20.12 required (Vitest 4 and Next 16). If the machine default is
> older, use a portable Node and prefix `PATH`.

> **Database guard:** `.env` may point at a shared (Neon) database, and
> Prisma migrations follow `DIRECT_URL`, not `DATABASE_URL`. `pnpm
> db:migrate` and `pnpm db:seed` therefore run `pnpm db:guard` first and
> refuse when either URL is non-local; override both to
> `postgresql://operanto:operanto@localhost:5435/operanto` for local work,
> or set `OPERANTO_DB_GUARD_ALLOW_REMOTE=1` when remote is truly intended
> (`pnpm db:deploy` stays unguarded — it is the intentional deploy path).

Send a signed synthetic event against the running app:

```sh
pnpm tsx scripts/send-test-event.ts                 # 202 + full projection
pnpm tsx scripts/send-test-event.ts --replay <id>   # 200 duplicate
pnpm tsx scripts/send-test-event.ts --bad-signature # 401
pnpm tsx scripts/send-test-event.ts --expired       # 401
```

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`.

## Documentation

- [docs/architecture.md](docs/architecture.md) — components, event pipeline, tenancy model
- [docs/operanto-conversations-foundation.md](docs/operanto-conversations-foundation.md) — conversations model, permissions, simulator, privacy behaviour
- [docs/operanto-customer-context.md](docs/operanto-customer-context.md) — channel identities and the customer-context panel
- [docs/operanto-conversation-workflows.md](docs/operanto-conversation-workflows.md) — tasks raised from conversations
- [docs/operanto-ai-handover.md](docs/operanto-ai-handover.md) — controlled AI assistance: providers, approvals, policy, budgets
- [docs/operanto-channel-foundation.md](docs/operanto-channel-foundation.md) — channel adapter contract, ingestion pipeline, consent, delivery statuses
- [docs/operanto-product-architecture.md](docs/operanto-product-architecture.md) — one external brand, public capability model, naming rules
- [docs/operanto-capability-gap-analysis.md](docs/operanto-capability-gap-analysis.md) — capability matrix across main, prototypes, and specs
- [docs/operanto-target-architecture.md](docs/operanto-target-architecture.md) — bounded capabilities and consolidation rules
- [docs/operanto-computer-program-status.md](docs/operanto-computer-program-status.md) — **Computer program status**: what is on main, what is switched off, gates that hold, and what remains (start here)
- [docs/operanto-computer-capability.md](docs/operanto-computer-capability.md) — Computer capability ADR: API-first execution routing, R0–R4 risk ladder, governance reuse (documented, dormant)
- [docs/operanto-computer-c1.md](docs/operanto-computer-c1.md) — Computer C1 domain foundation: session/plan/action/snapshot models, risk floors, unified approvals, privacy coverage (dormant, no executor)
- [docs/operanto-computer-c2.md](docs/operanto-computer-c2.md) — Computer C2 browser bridge: read-only tab sharing via MV3 extension, session-bound tokens, server-side sanitization, dev-DB migration guard (flag-gated off)
- [docs/operanto-computer-c3.md](docs/operanto-computer-c3.md) — Computer C3 page understanding + guide mode: grounded AI answers over shared tabs, deterministic evidence binding, /computer workbench (flag-gated off; guidance only, no execution)
- [docs/operanto-computer-c4.md](docs/operanto-computer-c4.md) — Computer C4 safe single navigation: one approved same-origin link opening per fresh observation, one-shot credentials, extension-side re-enforcement, server-side verification (flag-gated off)
- [docs/operanto-computer-c4-1.md](docs/operanto-computer-c4-1.md) — Computer C4.1 controlled execution validation: refusal auditing, derived metrics, failure taxonomy and C5 review criteria (no new capability, zero migrations)
- [docs/operanto-computer-c41-pilot.md](docs/operanto-computer-c41-pilot.md) — C4.1 pilot runbook: isolated pilot environment, 10-case first series, case record format, Checkpoint 1 template
- [docs/event-schema.md](docs/event-schema.md) — wire contract with Pronatona
- [docs/security.md](docs/security.md) — threat model, permission matrix, controls
- [docs/customer-matching.md](docs/customer-matching.md) — exact-match-only policy
- [docs/deployment.md](docs/deployment.md) — environments, DNS, staging-first rollout
- [docs/operations-runbook.md](docs/operations-runbook.md) — failed events, secret rotation, checklists
- [docs/data-ownership.md](docs/data-ownership.md) — system-of-record boundaries, future two-way plan

The previous product iteration (chat-first cockpit with AI assistant and
omnichannel inbox) is archived under
[legacy/chat-cockpit-prototype](legacy/chat-cockpit-prototype/ARCHIVE.md) and
is not compiled.
