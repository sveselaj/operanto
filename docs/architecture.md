# Architecture

## Components

```
Pronatona (system of record)                Operanto (projection + orchestration)
┌─────────────────────────────┐             ┌──────────────────────────────────┐
│ Lead form → createLead()    │             │ POST /api/v1/integrations/       │
│   └ tx: Lead + OutboxEvent  │   signed    │        pronatona/events          │
│ Admin actions → OutboxEvent │   HTTPS     │  verify HMAC → store InboundEvent│
│                             │  ────────►  │  → 202 → after(): process        │
│ Dispatcher (cron):          │             │                                  │
│  claim (SKIP LOCKED)        │             │ Handlers project:                │
│  sign + POST, backoff,      │             │  Customer · Opportunity ·        │
│  dead-letter                │             │  PropertyContext · Activity ·    │
└─────────────────────────────┘             │  Task · AuditEvent               │
                                            │                                  │
                                            │ Cockpit (app.operanto.ai)        │
                                            │ Marketing (operanto.ai)          │
                                            └──────────────────────────────────┘
```

One Next.js deployment serves marketing, cockpit, and API; `src/proxy.ts`
separates the hosts (marketing paths on `operanto.ai`, cockpit on
`app.operanto.ai`, only `/api/*` on `api.operanto.ai`). The proxy does **no**
authentication — every page, server action, and route handler re-checks the
session and organisation membership itself (data-access-layer pattern). If load
or team structure later demands it, `src/app/api` + `src/lib/events` extract
cleanly into a standalone service; the wire contract already assumes nothing
about colocation.

## Event pipeline

1. **Receipt** (`src/app/api/v1/integrations/pronatona/events/route.ts`):
   rate limit → size cap (256 KB) → required headers → replay window (±300 s)
   → HMAC-SHA256 verification (timing-safe, against the raw body, before JSON
   parsing) → integration status → Zod envelope validation → source-org match
   → **store `InboundEvent`** (unique on `integrationId + eventId`) → `202`.
   A unique violation returns `200 {duplicate:true}` — receipt is idempotent.
2. **Processing** (`src/lib/events/process.ts`): runs after the response
   (`after()`), and again from the retry sweep for failed/stuck rows. Single
   execution is guaranteed by an atomic conditional claim
   (`updateMany where processingStatus in (RECEIVED, FAILED)`). Failures
   increment `attemptCount`; after 5 attempts the event parks in
   `DEAD_LETTER` for admin review. `POST /api/internal/events/retry`
   (CRON_SECRET) sweeps `FAILED` and stuck rows.
3. **Projection** (`src/lib/events/handlers.ts`): every handler is
   idempotent — opportunities/property contexts/mappings are upserted on
   source-id unique constraints, activities are deduplicated per
   `(eventId, activityType)`, the follow-up task is created only with a new
   opportunity. Out-of-order arrivals (e.g. `lead.assigned` before
   `lead.created`) fail and are retried later, by which time the earlier event
   has usually landed.

## Tenancy model

- `User → Membership → Organisation`; roles (`ADMIN`, `SUPERVISOR`,
  `OPERATOR`) live on the membership, never globally on the user.
- The JWT carries only the user id and issue time. On every protected request
  `src/lib/org-context.ts` re-reads the user and membership from the database:
  suspension, role changes, and session revocation (`sessionsRevokedAt`) take
  effect immediately.
- Multi-org users select the active organisation via a cookie that can only
  choose among memberships verified ACTIVE on that request.
- Every tenant-scoped query spreads `scope(ctx)`
  (`{ organisationId: ctx.organisation.id }`); operators additionally get a
  record-level assignment filter (`opportunityAccessWhere`).

## Source-system identity

`ExternalIdentityMapping` maps `(sourceSystem, sourceEntityType,
sourceEntityId)` → Operanto entities: leads → opportunities, properties →
property contexts, Pronatona staff → Operanto memberships (maintained by
admins under `/integrations/pronatona`). Pronatona IDs are never used as
Operanto primary keys.

## What is intentionally absent in this release

Omnichannel inbox, social integrations, autonomous AI replies, workflow
builder, billing, two-way sync (Operanto never writes back to Pronatona), and
shared sign-on. The archived chat-cockpit prototype under `legacy/` contains
reference implementations for the AI-assisted phase.
