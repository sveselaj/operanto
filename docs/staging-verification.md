# Staging verification record

**Date:** 2026-07-30
**Environment:** Operanto running from the production build (`next start`) on the developer machine, backed by the **Neon staging database** (`ep-long-mountain-axv2gssmu` region us-east-2 — see `.env`; hostname elided here). Pronatona verification ran against a local scratch database (`pronatona_test`) — never against the live Pronatona Neon database.
**Tested commits:** Operanto `feat/pronatona-projection-mvp` (baseline `f956afe` + the staging-fix commits on the same branch), Pronatona `feat/operanto-outbox-dispatch` (baseline `4f57b72` + controlled-dispatch commit).
**Pending:** Vercel project + domains (`staging.operanto.ai`, `api-staging.operanto.ai`), Upstash staging instance, Vercel cron, Sentry/Resend credentials. Items depending on that infrastructure are marked **pending-infra** and must be re-run on the deployed staging URLs before approval.

Legend: ✅ verified · 🔁 verified locally, re-run on deployed staging · ⏳ pending-infra

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Migration succeeds | ✅ | `prisma migrate deploy` on clean local DB, on seeded DB (no-op), and on empty **Neon staging** — "All migrations have been successfully applied" |
| 2 | Seed succeeds exactly once | ✅ | Neon seed created org `pronatona`, admin, ACTIVE integration |
| 3 | Re-running seed is harmless | ✅ | Second + third runs: upserts only, "Integration already present — secret unchanged" |
| 4 | Administrator can sign in | ✅ | Playwright `login()` (real form → `/dashboard`) in every spec |
| 5 | Cockpit host routing | 🔁 | 8/8 unit tests in `src/proxy.test.ts` incl. staging combined-host mode; re-check on real domains |
| 6 | API host routing | 🔁 | Same suite: API host serves only `/api/*`, 404s HTML; re-check on real domains |
| 7 | Redis-backed rate limiting across requests | ⏳ | Code path implemented (Upstash REST, fail-open); no Upstash credentials yet — currently exercised with the in-memory fallback only |
| 8 | Retry cron authenticates | ✅ | Playwright: sweep with `Bearer $CRON_SECRET` processes pending events |
| 9 | Invalid cron auth → 401 | ✅ | Playwright: unauthenticated `POST /api/internal/events/retry` → 401 |
| 10 | Valid signed event → 202 | ✅ | Playwright acceptance test 1 (against Neon-backed server) |
| 11 | Duplicate → 200 | ✅ | Same test: `{ok:true, duplicate:true}` |
| 12 | Bad signature → 401 | ✅ | Same test |
| 13 | Expired timestamp → 401 | ✅ | Same test (−3600 s) |
| 14 | Unknown organisation → documented response | ✅ | 409 `source_organisation_mismatch` (curl, earlier run); documented in event-schema.md |
| 15 | Disabled integration rejected | ✅ | 403 path unit of route logic + manual curl in first milestone run |
| 16 | Oversized payload → 413 | ✅ | 300 KB body → 413 (curl) |
| 17 | Customer projection created | ✅ | Playwright: customer visible with email; DB row verified |
| 18 | Opportunity projection created | ✅ | Playwright: opportunity page renders |
| 19 | Property context attached | ✅ | Playwright: reference code + "View on Pronatona" link visible |
| 20 | Timeline complete | ✅ | Playwright: `inquiry.received`, `customer.created`, task activity visible |
| 21 | Follow-up task created | ✅ | Playwright: "Respond to new property inquiry" visible, HIGH/due set |
| 22 | Event audited | ✅ | `AuditEvent event.processed` rows on Neon; audit page renders them |
| 23 | Duplicate delivery ⇒ no duplicate projections | ✅ | Playwright: replay then exactly 1 opportunity + 1 customer row in UI; SQL counts = 1 |
| 24 | Failed processing retries | ✅ | Live: 2 events (5 s Neon tx-timeout bug, now fixed) recovered to PROCESSED by the sweep |
| 25 | Repeated failure reaches dead-letter | 🔁 | Unit-verified (`MAX_ATTEMPTS` claim gate + status transition); not yet forced live end-to-end |
| 26 | Admin can retry an eligible failed event | ✅ | Retry action + attempt-counter reset implemented and audited (`integration.event_retried`); exercised in first-milestone run |
| 27 | Cross-tenant access → 404 | ✅ | Playwright: foreign-org admin gets HTTP 404 on the opportunity URL |
| 28 | OPERATOR permissions enforced | ✅ | Playwright: unassigned opportunity absent from list, direct URL 404, `/settings/users` + `/audit` redirect to dashboard |
| 29 | Suspended membership loses access immediately | 🔁 | Enforced by DB-per-request membership reads (`org-context.ts`); covered by design + rbac tests; add a live staging spot-check |
| 30 | Secret not visible in logs or UI | ✅ | Playwright rotation spec asserts neither old nor new plaintext appears in page HTML; service layer strips ciphertext; raw secrets never logged |
| 31 | Pronatona functional without Operanto | ✅ | Existing "Operanto independence" e2e suite still green (82→85 unit tests; e2e unchanged); dispatcher no-ops without env |
| 32 | Dispatcher backoff correct | ✅ | Unit: 1→2→4…→60 min cap; live: failed row's `attempts`/`nextAttemptAt` advanced |
| 33 | Concurrency: no double claim | ✅ | Two parallel `FOR UPDATE SKIP LOCKED` claims on 4 pending rows → disjoint sets, 0 overlap |
| 34 | Marketing pages contain no false claims | ✅ | Case study labeled "First implementation — in progress"; no invented metrics/testimonials/logos (re-reviewed) |
| 35 | Playwright tests pass | ✅ | **7/7 passed (1.4 m)** against the Neon-backed production build |
| 36 | Lint, typecheck, unit tests, builds | ✅ | Operanto: lint ✓ typecheck ✓ 41 unit tests ✓ build ✓ · Pronatona: lint ✓ typecheck ✓ 85 tests ✓ build ✓ |

Additional verifications this round:

- **Rotation policy (fix C):** old secret accepted → rotate via admin UI → old secret 401, new secret 202, rotation audited (`integration.secret_rotated` ×4 on Neon), plaintext never rendered; policy is **immediate cutover** (no dual-secret window — documented in the runbook). AES-GCM tamper rejection covered by `crypto.test.ts`.
- **Health endpoints (fix D):** `/api/health`, `/api/health/database`, `/api/health/redis` (safely public, no secrets/config), `/api/health/worker` (CRON_SECRET-protected aggregates) — worker endpoint polled by the Playwright suite.
- **Neon-specific fix found by these tests:** Prisma's default 5 s interactive-transaction timeout expired against Neon latency (`Transaction already closed … 5158 ms`); projection transactions now run with a 30 s ceiling. This never reproduced on local Postgres — exactly the class of deviation staging verification exists to catch.
- **Controlled connection (Pronatona §7):** `OPERANTO_DISPATCH_SINCE` cutoff (invalid value ⇒ hold everything), held-back counter in `/admin/integrations`, per-event "Send now" for explicitly selected events; unit-tested.

## Deviations from local behaviour observed

1. Neon latency broke 5 s transaction defaults (fixed, see above).
2. `next dev` (Turbopack) wedged into a 100 % CPU loop once during webhook testing — all verification therefore runs against `next build && next start`. Does not affect deployed environments.
3. `NEXT_PUBLIC_*` are build-time inlined: host routing in a built app follows the values present at build, so per-environment builds are mandatory (standard on Vercel; documented in deployment.md).

## Cleanup before staging goes shared

- Remove or rotate the acceptance-test fixtures on the staging DB (`operator@operanto.local`, `admin@isolation-test.local`, `E2E Customer *`/`Rotation Probe *` rows) — they exist because the Playwright suite ran against this database, or reset + re-seed without `SEED_TEST_USERS`.
