# Staging verification record

## Post-DNS verification attempt — 2026-07-30 ~12:50 CEST — **BLOCKED**

**Deployed commit:** `5f04780c45ab24afa8a717f093a8f765dd090fec` (`5f04780`),
Vercel project `inovativi/operanto`, aliased to `operanto.ai`.

Post-DNS verification of items 1–11 **could not start**: the DNS records have
not reached the `operanto.ai` zone. This is not propagation delay or resolver
caching — the registrar's own authoritative nameservers still serve the old
records, and the zone serial is unchanged.

Evidence (all timestamps 2026-07-30, ~12:50 CEST):

| Probe | Result |
|---|---|
| `dig @ns59.domaincontrol.com operanto.ai A` | `3.33.130.190`, `15.197.148.33` (registrar parking; expected `76.76.21.21`) |
| `dig @ns59.domaincontrol.com operanto.ai SOA` | serial `2026073000` — **identical** to the pre-change snapshot taken before any work began, i.e. the zone has not been edited |
| `dig @ns59.domaincontrol.com staging.operanto.ai` | no record |
| `dig @ns59.domaincontrol.com api-staging.operanto.ai` | no record |
| `dig @ns59.domaincontrol.com www.operanto.ai CNAME` | `operanto.ai.` (old CNAME; expected `cname.vercel-dns.com.`) |
| Vercel domain config API, all four domains | `misconfigured: true`; apex `aValues: [3.33.130.190, 15.197.148.33]`, subdomains empty |
| TLS to `76.76.21.21` with SNI for each of the four hostnames | handshake fails — no certificate issued (the same edge IP completes a handshake for the project's `*.vercel.app` hostname, so the edge itself is reachable) |
| `dig +short TXT _dmarc.operanto.ai` | `v=DMARC1; p=quarantine; …` — **preserved, unchanged** |

Consequently: items 1 and 2 FAIL; items 3–11 are **not executable** and are
recorded as blocked rather than assumed. Nothing was marked verified on the
basis of local behaviour.

**Required records at GoDaddy** (`ns59/ns60.domaincontrol.com`) — unchanged
from the previous report:

| Host | Type | Value | TTL |
|---|---|---|---|
| `@` | A | `76.76.21.21` | 600 |
| `www` | CNAME | `cname.vercel-dns.com.` | 600 |
| `staging` | CNAME | `cname.vercel-dns.com.` | 600 |
| `api-staging` | CNAME | `cname.vercel-dns.com.` | 600 |

Delete the two parking A records on `@` and the `www → operanto.ai` CNAME.
Common reasons an edit does not take effect: the change was made in a
different GoDaddy account or on a different domain; GoDaddy **Domain
Forwarding / parking** is still enabled and re-asserts the parking A records
(disable Forwarding first); or the edit was not saved/published.

**Re-run when the records are live** — the whole checklist is automated:

```sh
./scripts/verify-staging.sh --dns-only     # gate: resolution + certificates
./scripts/verify-staging.sh                # items 1,2,3,4,5,6,7,9,10,11
PLAYWRIGHT_BASE_URL=https://staging.operanto.ai pnpm test:e2e:remote   # item 8 + 9
```

Certificates are issued by Vercel automatically once the records resolve;
allow a few minutes after propagation before the certificate probes pass.

### Verified without DNS, by Host-header simulation against a build carrying the real hostnames

Item 6 and item 7 were exercised this round by building with the production
`NEXT_PUBLIC_*` values and addressing the running server with each real
`Host` header. This is the same input the proxy sees in production, so the
routing decisions are meaningful; it does **not** substitute for the TLS,
certificate, cookie-scope and platform-routing behaviour of the real hosts.

| Host | Path | Result |
|---|---|---|
| `operanto.ai` | `/`, `/product` | 200 (marketing) |
| `operanto.ai` | `/dashboard` | 307 → `https://staging.operanto.ai/dashboard` |
| `operanto.ai` | `POST /api/v1/integrations/pronatona/events` | **404** |
| `operanto.ai` | `/api/auth/session` | **404** |
| `operanto.ai` | `/api/health`, `/api/health/database` | 200 |
| `operanto.ai` | `/api/internal/events/retry` (no secret) | 401 |
| `staging.operanto.ai` | `/login` | 200 |
| `staging.operanto.ai` | `/dashboard` unauthenticated | 307 → `/login` |
| `staging.operanto.ai` | `/api/auth/session` | 200 |
| `staging.operanto.ai` | `POST /api/v1/…` | **404** |
| `api-staging.operanto.ai` | `/api/health` | 200 |
| `api-staging.operanto.ai` | `/`, `/dashboard`, `/customers/a.b`, `/invite/tok.en` | **404** (no marketing or cockpit HTML, dotted paths included) |
| `api-staging.operanto.ai` | `POST /api/v1/…` (no signature headers) | 401 |
| unknown host (`evil.example.com`, `*.vercel.app`) | `POST /api/v1/…`, `/api/auth/session` | **404**; marketing and `/api/health*` remain 200 |

**Defect found and fixed this round:** the marketing host was answering the
ingestion route with `401 missing_headers` instead of 404 — the proxy only
restricted `/api/*` on *unknown* hosts, so `operanto.ai` exposed an API
surface that the deployment brief forbids. Fixed in `5f04780`; the marketing
host now serves no application API (health probes and the CRON_SECRET-gated
scheduler surface are the only exceptions), and the cockpit host keeps
`/api/auth/*` but 404s `/api/v1/*`. Covered by two new cases in
`src/proxy.test.ts` (49 unit tests total).

Still explicitly **incomplete/unprovisioned** regardless of DNS: shared
Upstash Redis, Sentry, Resend invitation email delivery.

---


**Date:** 2026-07-30
**Operanto commit under test:** see `git log` on `feat/pronatona-projection-mvp` (tip at time of writing: the "Harden acceptance suite…" commit).
**Environment:** Operanto production build (`next build && next start`) backed by the **Neon staging database**; host-routing behaviour additionally unit-tested. Pronatona verification ran against a local scratch database (`pronatona_test`) — never the live Pronatona database.
**Not yet verified on deployed infrastructure:** `staging.operanto.ai` / `api-staging.operanto.ai` do not resolve yet (DNS records pending at the registrar), so every item below marked 🔁 must be repeated against the real hosts before staging is declared passed.

Legend: ✅ verified as stated · 🔁 verified locally / at unit level, must be repeated on deployed staging · ⏳ blocked on infrastructure

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Migration succeeds | ✅ | `prisma migrate deploy` on a clean local DB, on a seeded DB (no-op), and on the empty Neon staging DB |
| 2 | Seed succeeds exactly once | ✅ | Neon: organisation `pronatona`, admin, ACTIVE integration created once |
| 3 | Re-running seed is harmless | ✅ | Repeated runs upsert only; "Integration already present — secret unchanged" |
| 4 | Administrator can sign in | 🔁 | Playwright logs in through the real form in every spec (local host) |
| 5 | Cockpit host routing | 🔁 | 8 unit tests in `src/proxy.test.ts` incl. staging combined-host mode; **not yet exercised on real hosts** |
| 6 | API host routing | 🔁 | Same suite: API host serves only `/api/*` |
| 7 | Redis-backed rate limiting across requests | ⏳ | Upstash not provisioned; in-memory fallback in use. **Unverified.** |
| 8 | Retry cron authenticates | ✅ | Playwright drives `/api/internal/events/retry` with `Bearer $CRON_SECRET`; `retryPendingEvents` unit-tested in `src/lib/events/process.test.ts` |
| 9 | Invalid cron auth → 401 | ✅ | Playwright asserts 401 for the sweep and the status endpoint |
| 10 | Valid signed event → 202 | ✅ | Playwright acceptance test 1 (Neon-backed) |
| 11 | Duplicate → 200 | ✅ | Same test: `{ok:true, duplicate:true}` |
| 12 | Bad signature → 401 | ✅ | Same test |
| 13 | Expired timestamp → 401 | ✅ | Same test (−3600 s) |
| 14 | Unknown organisation → 409 | ✅ | Now asserted in the acceptance suite (correctly signed, foreign `organisationId`) |
| 15 | Disabled integration rejected | 🔁 | Route logic returns 403; exercised by curl in the first milestone run, **not** in the automated suite |
| 16 | Oversized payload → 413 | 🔁 | Verified by curl (300 KB) in the first milestone run; not automated |
| 17–21 | Customer / opportunity / property context / timeline / follow-up task | ✅ | Playwright asserts each against per-run unique strings; **mutation-tested**: disabling task creation makes the suite fail |
| 22 | Event audited | ✅ | `event.processed` audit rows on Neon |
| 23 | Duplicate delivery ⇒ no duplicate projections | ✅ | Replay then exactly one opportunity and one customer in the UI |
| 24 | Failed processing retries | ✅ | Live recovery of two events after the Neon transaction-timeout fix; `retryPendingEvents` unit-tested |
| 25 | Repeated failure reaches dead-letter | 🔁 | Unit-tested (`process.test.ts`: final attempt ⇒ DEAD_LETTER); not forced end-to-end |
| 26 | Admin can retry an eligible failed event | 🔁 | Implemented + audited; exercised manually in the first milestone run |
| 27 | Cross-tenant access → 404 | ✅ | Playwright: foreign-org admin receives HTTP 404 |
| 28 | OPERATOR permissions enforced | ✅ | Playwright with positive controls (own pages render), absence from list, direct URL 404, admin routes redirect |
| 29 | Suspended membership loses access immediately | 🔁 | Enforced by per-request DB membership reads; **no automated test yet** |
| 30 | Secret not visible in logs or UI | ✅ | Rotation spec asserts neither old nor new plaintext appears in the page HTML |
| 31 | Pronatona functional without Operanto | ✅ | Existing "Operanto independence" e2e still green; dispatcher no-ops unconfigured |
| 32 | Dispatcher backoff correct | ✅ | Unit: 1→2→4…→60 min cap |
| 33 | Concurrency: no double claim | ✅ | Two parallel `FOR UPDATE SKIP LOCKED` claims over 4 pending rows → disjoint, zero overlap |
| 34 | Marketing pages contain no false claims | ✅ | Case study labelled "First implementation — in progress"; no invented metrics, testimonials or logos |
| 35 | Playwright tests pass | ✅ | **7/7** against the Neon-backed build |
| 36 | Lint, typecheck, unit tests, builds | ✅ | Operanto: lint ✓ typecheck ✓ **47 unit tests** ✓ build ✓ · Pronatona: lint ✓ typecheck ✓ **87 tests** ✓ build ✓ |

## Adversarial review (52 agents, 4 lenses, 2 skeptics per finding)

Ten findings survived verification and were fixed on the branches; two were
refuted and dropped. The material ones:

1. **HIGH — fixture credentials.** `SEED_TEST_USERS=1` created live accounts
   with passwords hardcoded in the repository, one of them an OPERATOR of the
   real Pronatona organisation, and the fixtures were already present in the
   Neon staging database. **Fixed:** passwords must now come from
   `SEED_TEST_OPERATOR_PASSWORD` / `SEED_TEST_ISOLATION_ADMIN_PASSWORD`, the
   seed refuses to create fixtures when `NODE_ENV=production`, and re-seeding
   now rotates the fixture password rather than silently keeping the old one.
   The staging database's fixture passwords were rotated to fresh random
   values; the previously committed passwords no longer work anywhere.
2. **MEDIUM — dispatch cutoff failed open.** An absent `OPERANTO_DISPATCH_SINCE`
   meant "send everything", so enabling delivery without it would have drained
   the entire historical outbox (real customer names, emails, phones, enquiry
   text) to whatever URL was configured. **Fixed:** batch dispatch now HOLDS
   unless a cutoff is set, with `OPERANTO_DISPATCH_ALL=1` as the deliberate
   opt-out; the admin screen states which mode is active.
3. **LOW — proxy matcher.** `.*\..*` excluded every path containing a dot, so
   host separation silently skipped `/customers/a.b`, `/invite/tok.en`, etc.
   **Fixed:** the matcher now excludes only `_next/`.
4. **Test validity (7 findings).** The previous suite could have passed on a
   broken system: `getByText("PROCESSED")` matched the always-present summary
   tile; the rotation restore sat outside `try/finally` (a mid-test failure
   would have stranded a random secret); `processPendingEvents` gated on
   global worker health, so one unrelated dead-lettered row would fail every
   later run; the audit assertion was satisfied by rows from earlier runs; the
   OPERATOR check was absence-only with no positive control; the retry sweep
   was unfalsifiable because `after()` masked it; and
   `OPERANTO_STALE_EVENT_MINUTES=0` let the sweep re-claim in-flight events.
   **All fixed** — plus a new per-event status endpoint, unit tests for the
   sweep, and a **mutation test** (disabling follow-up task creation makes the
   suite fail), which is the evidence that these assertions now bite.

## Deviations from local behaviour observed

1. **Neon latency broke Prisma's 5 s interactive-transaction default**
   (`Transaction already closed … 5158 ms`); projection transactions now use a
   30 s ceiling. Never reproduced on local Postgres.
2. **`NEXT_PUBLIC_*` are build-time inlined**, so a build carrying the real
   hostnames correctly 404s API calls arriving on `localhost`. Local e2e now
   rebuilds with single-host URLs; `AUTH_URL` is read at runtime and must
   match the host serving the cockpit, or sign-in redirects off-host.
3. **Vercel builds need `prisma generate`** (added as `postinstall`), otherwise
   type-checking fails with "no exported member 'PrismaClient'".
4. `next dev` (Turbopack) wedged into a CPU spin once during webhook testing;
   all verification runs against `next build && next start`.

## Cleanup before staging is shared

Fixture accounts (`operator@operanto.local`, `admin@isolation-test.local`) and
acceptance-test rows (`E2E Customer *`, `Rotation Probe *`) exist in the Neon
staging database because the suite runs against it. Their passwords are random
and known only to the operator who ran the seed. Remove them, or reset and
re-seed without `SEED_TEST_USERS`, before granting wider staging access.
