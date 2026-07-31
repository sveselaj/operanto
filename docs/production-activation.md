# Production activation — PREPARATION ONLY

Nothing in this document has been created or activated. `app.operanto.ai` and
`api.operanto.ai` do not exist, no production Operanto database exists, and
Pronatona production event delivery is disabled. Activation requires explicit
approval.

## Current state (2026-07-31)

| Surface | State |
|---|---|
| `operanto.ai` / `www.operanto.ai` | **Live** — public marketing only |
| `staging.operanto.ai` | **Live** — cockpit, staging data only |
| `api-staging.operanto.ai` | **Live** — API, staging data only |
| `app.operanto.ai` | Reserved, **not created** |
| `api.operanto.ai` | Reserved, **not created** |
| Pronatona production dispatch | **Disabled** — no `OPERANTO_*` variables anywhere |

## Prerequisites before activation

1. **Upstash Redis (staging first, then production)** — see below. Required
   before inviting a wider operational team, because authentication rate
   limits currently count per-instance.
2. **Sentry** — separate staging and production projects. Required before
   production event processing at meaningful volume; without it, a failing
   handler is visible only in the integration health screen and Vercel logs.
   Scrub customer PII: event payloads contain names, emails, phones and
   inquiry text, so `beforeSend` must strip request bodies, and secrets must
   never be attached to a scope.
3. **Resend** — required before normal staff onboarding. Until configured,
   `sendMail` logs the invitation URL to the server console; that is
   acceptable in controlled staging only. **Production must never log raw
   invitation links or tokens** — verify before the first production invite.
4. **CI** — neither repository has GitHub Actions. Add a workflow running
   lint, typecheck, unit tests and build on pull requests before the team
   grows beyond the current reviewers.

## Upstash Redis provisioning

Create a **separate database per environment** (staging and production never
share counters — a staging load test must not lock out production logins).

```
UPSTASH_REDIS_REST_URL=https://<db>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

This REST pair is the **only** supported convention. A bare `REDIS_URL` is
deliberately not read by any code path: two conventions mean one is silently
ignored, and a rate limiter that is silently not running is worse than none.
`NEXT_PUBLIC_*` are build-time inlined but these are server-only, so a redeploy
is needed only because Vercel does not apply changed variables to existing
deployments.

Verification after configuring:

1. `GET https://api-staging.operanto.ai/api/health/redis` → `{"ok":true,"configured":true,...}`.
2. Shared counting across requests: send 11 failed logins for one email within
   15 minutes; the 11th must be refused. Repeat from a second client/IP — the
   count is per-account, so it must still be refused, proving the counter is
   shared rather than per-instance.
3. Failure behaviour: temporarily point `UPSTASH_REDIS_REST_URL` at an
   unreachable host and confirm login is **refused** (fail-closed) while
   marketing pages and health endpoints stay available. Restore afterwards.

### Which limits fail closed, and which fall back

| Limit | Key | Policy when Redis is configured but unreachable |
|---|---|---|
| Login, per account | `login:acct:<email>` | **Fail closed** — request denied |
| Invitation acceptance, per IP | `invite:<ip>` | **Fail closed** — request denied |
| Event ingestion, per IP | `ingest:<ip>` | Falls back to per-instance memory (fail-open) |

Rationale: an attacker who can degrade Redis must not thereby gain unlimited
password guesses. Ingestion is signed with HMAC and additionally protected by
a replay window and payload cap, so availability is preferred there — losing
Pronatona events because Redis is down would be the worse failure. Covered by
`src/lib/rate-limit.test.ts`.

## Activation sequence (do not execute without approval)

1. **Provision the production Operanto database** (separate Neon project or
   branch — never the staging one).
2. **Apply migrations**: `pnpm db:deploy` (`prisma migrate deploy`). Never
   `db push`, never `migrate reset`.
3. **Bootstrap organisation and administrator**: run `pnpm db:seed` with
   production `SEED_ADMIN_*`, a fresh `PRONATONA_WEBHOOK_SECRET`, and the real
   `PRONATONA_SOURCE_ORGANISATION_ID`. Do **not** set `SEED_TEST_USERS` — the
   seed refuses fixtures when `NODE_ENV=production`, and that guard should
   never be the only thing standing in the way.
4. **Configure production Upstash** (separate database and token).
5. **Configure Sentry** (production project, PII scrubbing verified).
6. **Deploy `app.operanto.ai` and `api.operanto.ai`**: add both domains to the
   Vercel project, set the production environment variables
   (`NEXT_PUBLIC_SITE_URL=https://operanto.ai`,
   `NEXT_PUBLIC_APP_URL=https://app.operanto.ai`,
   `NEXT_PUBLIC_API_URL=https://api.operanto.ai`,
   `AUTH_URL=https://app.operanto.ai`), then redeploy — these values are
   inlined at build time. Add DNS `app` and `api` as CNAMEs to
   `cname.vercel-dns.com.`, and **issue certificates explicitly**
   (`vercel certs issue app.operanto.ai`): during the staging cutover Vercel
   auto-issued only the apex, and the CNAME hosts served no certificate until
   asked.
7. **Verify Operanto independently**: `./scripts/verify-staging.sh` adapted to
   the production hostnames, then the acceptance suite with
   `PLAYWRIGHT_BASE_URL=https://app.operanto.ai
   PLAYWRIGHT_API_BASE_URL=https://api.operanto.ai`. Everything must pass
   **before** Pronatona is pointed at it.
8. **Configure Pronatona with a cutoff later than every historical outbox
   event**:
   ```sh
   # Confirm the newest existing event first:
   psql "$DATABASE_URL" -c 'SELECT max("occurredAt") FROM "OutboxEvent";'
   OPERANTO_DISPATCH_SINCE=<a timestamp strictly after that>
   ```
   The cutoff fails closed, so omitting it holds all dispatch rather than
   flooding — but set it deliberately rather than relying on the guard.
9. **Disable automatic cron initially**: remove the `crons` entry from
   Pronatona's `vercel.json` (or leave `CRON_SECRET` unset) so nothing
   dispatches on a timer during the first observation window.
10. **Send one explicitly selected test event** via `/admin/integrations` →
    "Send now" on a single new event. Fictional data only.
11. **Verify projection and idempotency** in the production cockpit: customer,
    opportunity, property context, timeline, follow-up task; then re-send and
    confirm `200 duplicate` with no new rows.
12. **Enable dispatch for new events only**: set `OPERANTO_EVENTS_URL` and
    `OPERANTO_WEBHOOK_SECRET` on Pronatona (matching the production Operanto
    integration secret), keep `OPERANTO_DISPATCH_SINCE`, and restore the cron
    entry.
13. **Observe before widening**: watch `/admin/integrations` (outbox depth,
    retrying, dead-letter) and Operanto's `/integrations/pronatona` and
    `/api/health/worker` for at least one business day before treating the
    integration as routine.

## Rollback at any step

Removing `OPERANTO_EVENTS_URL` or `OPERANTO_WEBHOOK_SECRET` makes the
dispatcher an immediate no-op with no deploy — that is the kill switch. Events
continue accumulating safely in Pronatona's outbox and can be delivered later.
Operanto's own rollback is a revert plus redeploy; its database holds only
projections, and Pronatona remains the system of record throughout.
