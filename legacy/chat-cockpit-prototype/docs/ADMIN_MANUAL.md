# Operanto — System Administrator Manual

> Operational guide for installing, configuring, securing, and maintaining an
> Operanto deployment. For product/architecture rationale see
> [BLUEPRINT.md](BLUEPRINT.md).

Version 0.1 · Last updated 2026-05-26

---

## 1. Audience & scope

This manual is for whoever runs Operanto: provisioning the database, setting
environment secrets, managing workspaces and members, wiring up channels, and
keeping AI/audit features healthy. It assumes shell access to the host and the
ability to set environment variables.

Note on roles: Operanto has **no global super-admin role**. Administration is
scoped to a *workspace* — the highest role is `owner`, with `admin` equivalent
(see §6). "System admin" in this document means the operator who owns the
deployment + the environment, plus an `owner`/`admin` member inside each
workspace.

---

## 2. System requirements

- **Node.js** 20+
- **pnpm**
- **Docker** (for the bundled PostgreSQL) — or any reachable PostgreSQL 16
- **PostgreSQL** 16 (the Docker image; host port **5433** by default)
- Outbound HTTPS to the AI provider (Anthropic) — optional; the app runs in
  mock mode without it (see §7)

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 6
· Auth.js v5 · Anthropic (configurable).

---

## 3. Installation

```bash
pnpm install
cp .env.example .env          # then edit secrets — see §4
pnpm db:up                    # start Postgres (Docker, host port 5433)
pnpm db:push                  # create/sync the schema
pnpm db:seed                  # load demo data (optional; see §8)
pnpm dev                      # http://localhost:3000
```

Production build:

```bash
pnpm build
pnpm start
```

> The bundled Postgres maps host port **5433** to avoid clashing with a local
> Postgres on 5432. To change it, edit both [docker-compose.yml](../docker-compose.yml)
> and `DATABASE_URL` in `.env`.

---

## 4. Configuration (environment variables)

All configuration is via `.env` (template: `.env.example`). There is **no
in-app settings screen for secrets** — they are environment-only by design.

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required. Default points at the Docker DB on `localhost:5433`. |
| `AUTH_SECRET` | Auth.js session/JWT signing key | **Required in production.** Generate: `openssl rand -base64 32`. Rotating it invalidates all sessions. |
| `AUTH_TRUST_HOST` | Trust the host header | Keep `true` behind a known proxy; review for your deployment. |
| `ANTHROPIC_API_KEY` | AI provider key | Leave empty to run AI in **mock mode** (no external calls). |
| `AI_PROVIDER` | Provider selector | `anthropic` (default) or `mock`. Unknown values fall back to mock. |
| `AI_MODEL_GENERATION` | Model for high-stakes generation | Default `claude-opus-4-7` (drafts, SOPs, content, insights). |
| `AI_MODEL_CLASSIFY` | Model for cheap classification | Default `claude-haiku-4-5-20251001` (intent/sentiment/lead-score). |
| `ENCRYPTION_KEY` | AES key for channel tokens at rest | **Required if connecting real channels.** 32-byte base64: `openssl rand -base64 32`. Losing/changing it makes stored tokens undecryptable. |

**Before going to production**, replace every `change-me` placeholder value in
`.env`. The shipped defaults for `AUTH_SECRET` and `ENCRYPTION_KEY` are insecure
development values.

---

## 5. Database administration

| Command | What it does |
|---|---|
| `pnpm db:up` | Start the Docker Postgres container |
| `pnpm db:push` | Sync the Prisma schema to the DB (no migration files) |
| `pnpm db:seed` | Load demo data (idempotent — wipes & recreates tenant data) |
| `pnpm db:reset` | `db:push --force-reset` **then** reseed — **destroys all data** |
| `pnpm db:studio` | Open Prisma Studio (web DB browser) for inspection/edits |

The schema lives in [prisma/schema.prisma](../prisma/schema.prisma); the seed
in [prisma/seed.ts](../prisma/seed.ts).

**⚠️ `pnpm db:reset` and `pnpm db:seed` are destructive** — the seed deletes all
tenant rows (users, workspaces, conversations, …) before recreating demo data.
Never run them against a database that holds real customer data.

**Backups:** Operanto ships no backup tooling. Use standard PostgreSQL backups,
e.g. `pg_dump`:

```bash
pg_dump "$DATABASE_URL" > operanto-backup-$(date +%F).sql
```

Schema changes use `prisma db push` (no migration history is committed). For a
production change, snapshot the DB first, then push.

---

## 6. Identity, roles & permissions

### Roles

Roles are per-workspace, defined in
[src/lib/rbac.ts](../src/lib/rbac.ts). The permission matrix is the **single
source of truth** and is enforced server-side on every mutation; the UI only
hides controls.

| Permission | owner | admin | manager | agent | reviewer | client_viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `workspace:manage` (settings) | ✓ | ✓ | – | – | – | – |
| `members:manage` (team/roles) | ✓ | ✓ | – | – | – | – |
| `channels:manage` | ✓ | ✓ | ✓ | – | – | – |
| `conversations:read` | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `conversations:reply` (outbound) | ✓ | ✓ | ✓ | ✓ | – | – |
| `conversations:triage` | ✓ | ✓ | ✓ | ✓ | – | – |
| `tasks:manage` | ✓ | ✓ | ✓ | ✓ | – | – |
| `sops:create` | ✓ | ✓ | ✓ | – | – | – |
| `sops:approve` | ✓ | ✓ | – | – | – | – |
| `content:manage` | ✓ | ✓ | ✓ | ✓ | – | – |
| `qa:review` | ✓ | ✓ | ✓ | – | ✓ | – |
| `reports:view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `automations:manage` | ✓ | ✓ | ✓ | – | – | – |
| `ai:run` | ✓ | ✓ | ✓ | ✓ | – | – |

`owner` and `admin` are functionally identical today. `client_viewer` sees only
reports.

### Multi-tenancy guarantee

Tenant isolation is enforced at the data-access layer, not by per-query
discipline. `requireWorkspace(slug)` in [src/lib/workspace.ts](../src/lib/workspace.ts)
resolves the caller's membership; `scope(ctx)` injects `workspaceId` into every
tenant query. A user who is not a member of a workspace is redirected away.
**Cross-workspace access is impossible by construction.**

### Provisioning users & changing roles

The Team page ([/[workspace]/team](../src/app/[workspace]/team/page.tsx)) and
Settings page are **read-only views** in this build — there is no UI yet to
invite members or change roles. Administer users via the database:

- **Add a user / membership**: create a `User` (with a bcrypt `passwordHash`)
  and a `WorkspaceMember` row (`workspaceId`, `userId`, `role`, `status:
  "active"`). The seed script ([prisma/seed.ts](../prisma/seed.ts)) shows the
  exact pattern, including `bcrypt.hash(password, 10)`.
- **Change a role / deactivate**: edit the member's `role` or `status` field via
  `pnpm db:studio` or SQL.

Auth is credentials-based (Auth.js v5, see [src/lib/auth.ts](../src/lib/auth.ts));
passwords are bcrypt-hashed. There is no self-service signup or password reset
flow in the MVP — admins set passwords directly.

---

## 7. AI provider administration

AI runs through a provider-agnostic service
([src/lib/ai/service.ts](../src/lib/ai/service.ts)) with config in
[src/lib/ai/config.ts](../src/lib/ai/config.ts).

- **Mock mode** is automatic when `ANTHROPIC_API_KEY` is empty or
  `AI_PROVIDER=mock`. Every AI task returns a deterministic built-in result and
  makes **no external calls** — the whole app is usable without credentials.
- **Live mode**: set `ANTHROPIC_API_KEY` and `AI_PROVIDER=anthropic`.
- **Model routing**: classification (intent/sentiment/lead-score) uses the
  cheaper `AI_MODEL_CLASSIFY`; generation (drafts/SOPs/content/insights) uses
  `AI_MODEL_GENERATION`.

**AI tasks** in this build: `summarizeConversation`, `classifyConversation`,
`draftReply`, `generateSOP`, `generateContent`, `managerInsights`.

**Safety invariants** (do not weaken without review): AI only *suggests* —
humans approve; customer messages are never auto-sent by default; every AI run
is logged with model, output, and confidence. Verify these hold after any change
to the AI layer.

---

## 8. Demo / seed data

The seed creates two workspaces with realistic content for the launch niche
(beauty/aesthetics + boutique ecommerce). All demo accounts use password
`operanto`.

| Email | Workspace | Role |
|---|---|---|
| `lana@bloomstudio.test` | Bloom Studio | owner |
| `marko@bloomstudio.test` | Bloom Studio | manager |
| `driton@bloomstudio.test` | Bloom Studio | agent |
| `rina@bloomstudio.test` | Bloom Studio | reviewer |
| `elira@lumeagoods.test` | Lumea Goods | owner |
| `blerim@lumeagoods.test` | Lumea Goods | agent |

> **Change or remove these accounts before any non-demo deployment.** They have
> a known, shared password.

---

## 9. Channels & ingestion

Channels are managed under workspace **Settings**
([/[workspace]/settings](../src/app/[workspace]/settings/page.tsx)). Each
`ChannelAccount` shows its status and its inbound endpoint.

- **Inbound endpoint**: `POST /api/webhooks/{channel}`
  ([route](../src/app/api/webhooks/[channel]/route.ts)). Payloads are normalized
  into a common `Message` shape regardless of source.
- **Web chat / manual** work today with no credentials — gated by the
  unguessable `channelAccountId`. The public widget lives at
  [/widget/[channelAccountId]](../src/app/widget/[channelAccountId]/page.tsx).
- **Instagram, Facebook, WhatsApp, email, SMS** connectors are implemented
  behind a common `Channel` interface
  ([src/lib/channels/index.ts](../src/lib/channels/index.ts)) but require
  credentials + webhook signature verification to activate (post-MVP).
- Real providers must pass `verifySignature` before ingestion; demo channels
  accept. Channel tokens are encrypted at rest with `ENCRYPTION_KEY` and are
  never returned to the client.

---

## 10. Auditing & monitoring

- **Audit log**: every AI action and sensitive mutation (status change,
  assignment, SOP approval, send) writes an `AuditLog` row
  ([src/lib/audit.ts](../src/lib/audit.ts)) with actor, action, entity, and
  before/after JSON. Inspect via `pnpm db:studio` or SQL on the `AuditLog`
  table.
- **AI actions**: each AI run is recorded as an `AIAction` (model, input,
  output, confidence, status) for evaluation and cost tracking.
- **App logs**: standard Next.js server logs (`pnpm dev` / `pnpm start`).

---

## 11. Routine operations & troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Can't connect to DB | Container down → `pnpm db:up`; or `DATABASE_URL` port mismatch (default **5433**). |
| "database is not in sync" | Run `pnpm db:push`. |
| All users logged out after deploy | `AUTH_SECRET` changed — expected; users re-authenticate. |
| AI features return canned output | Mock mode — set `ANTHROPIC_API_KEY` + `AI_PROVIDER=anthropic`. |
| Channel tokens fail to decrypt | `ENCRYPTION_KEY` changed/lost — reconnect channels. |
| Port 3000 in use | Set `PORT` env or stop the conflicting process. |
| Need a clean demo env | `pnpm db:reset` (**destroys data** — never on production). |

**Health check**: log in with a seeded account and confirm the command center
renders prioritized conversations and open tasks.

---

## 12. Production hardening checklist

- [ ] Replace `AUTH_SECRET` with a freshly generated value.
- [ ] Replace `ENCRYPTION_KEY` with a freshly generated value (before storing
      any channel tokens).
- [ ] Remove or re-password all seeded demo accounts (§8).
- [ ] Point `DATABASE_URL` at a managed/backed-up PostgreSQL, not the Docker dev
      instance.
- [ ] Establish a `pg_dump` (or managed) backup schedule.
- [ ] Decide AI mode: set `ANTHROPIC_API_KEY` for live AI, or document that the
      deployment runs in mock mode.
- [ ] Confirm `AUTH_TRUST_HOST` matches your proxy setup.
- [ ] Serve over HTTPS behind a trusted reverse proxy.
- [ ] Verify the AI safety invariants (§7) still hold.

---

## 13. Reference

- Product & technical blueprint: [BLUEPRINT.md](BLUEPRINT.md)
- Permission matrix: [src/lib/rbac.ts](../src/lib/rbac.ts)
- Workspace scoping: [src/lib/workspace.ts](../src/lib/workspace.ts)
- Auth: [src/lib/auth.ts](../src/lib/auth.ts)
- AI config/service: [src/lib/ai/config.ts](../src/lib/ai/config.ts), [src/lib/ai/service.ts](../src/lib/ai/service.ts)
- Channels: [src/lib/channels/index.ts](../src/lib/channels/index.ts)
- Schema & seed: [prisma/schema.prisma](../prisma/schema.prisma), [prisma/seed.ts](../prisma/seed.ts)
</content>
</invoke>
