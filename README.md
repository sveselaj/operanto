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
| `app.operanto.ai` | Cockpit (`src/app/(app)`) — `/dashboard`, `/customers`, `/opportunities`, `/tasks`, `/activity`, `/integrations/pronatona`, `/settings/*`, `/audit` |
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
- [docs/operanto-product-architecture.md](docs/operanto-product-architecture.md) — one external brand, public capability model, naming rules
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
