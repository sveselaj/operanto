# Deployment

## Environments

| Environment | Cockpit | API | Database |
|---|---|---|---|
| Production | `app.operanto.ai` | `api.operanto.ai` | Neon (production branch) |
| Staging | `staging.operanto.ai` | `api-staging.operanto.ai` | Neon (staging branch) |
| Marketing | `operanto.ai` (+ `www`) | — | — |

One Next.js project serves all surfaces; attach all domains to the same Vercel
project (staging = a second Vercel project or a preview deployment with fixed
domains). `src/proxy.ts` routes by host using `NEXT_PUBLIC_SITE_URL` /
`NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_API_URL`. Use **different secrets per
environment** — always.

## DNS (operanto.ai)

| Record | Type | Value |
|---|---|---|
| `operanto.ai` | A / ALIAS | Vercel (`76.76.21.21` or as instructed by Vercel) |
| `www` | CNAME | `cname.vercel-dns.com` (redirect to apex in Vercel) |
| `app` | CNAME | `cname.vercel-dns.com` |
| `api` | CNAME | `cname.vercel-dns.com` |
| `staging` | CNAME | `cname.vercel-dns.com` (staging project) |
| `api-staging` | CNAME | `cname.vercel-dns.com` (staging project) |
| future: `docs`, `status` | CNAME | reserved |

## Host routing (one Next.js project, several hosts)

`src/proxy.ts` selects a SURFACE from an explicit allowlist built from the
three `NEXT_PUBLIC_*_URL` values — it never derives identity or permissions
from the Host header (every page/action/route re-authenticates itself):

- **API host** (`api.operanto.ai` / `api-staging.operanto.ai`): `/api/*` only;
  anything else is 404 — it never renders marketing or cockpit HTML.
- **App host**: cockpit; on a dedicated app host `/` redirects to
  `/dashboard`. **Staging runs combined-host mode** (`SITE_URL == APP_URL`):
  marketing and cockpit share `staging.operanto.ai` while the API host stays
  isolated.
- **Marketing host**: cockpit paths redirect to the app host.
- **Unknown hosts** (extra domains pointed at the deployment, `*.vercel.app`
  preview URLs): least-privileged surface — marketing pages and `/api/health*`
  only; cockpit paths redirect to the canonical app host; other `/api/*` 404s.

Covered by unit tests in `src/proxy.test.ts` (including forged
`X-Forwarded-Host` with an unknown `Host`).

Known limitations of serving multiple hosts from one Vercel project:

- `NEXT_PUBLIC_*` values are **inlined at build time** — each environment
  needs its own build with its own values (Vercel does this per project /
  environment; a preview build carries preview values).
- Vercel normalizes `Host`/`X-Forwarded-Host` to the routed domain; the
  allowlist is defense-in-depth for non-Vercel/origin access.
- Cookies are host-scoped (no `Domain` attribute): sessions on
  `app.operanto.ai` do not leak to the marketing host; in combined-host
  staging there is only one host anyway. Auth.js callback URLs come from
  `AUTH_URL` — set it to the cockpit host per environment.
- Canonical URLs use `metadataBase` = `NEXT_PUBLIC_SITE_URL`, so marketing
  pages canonicalize to the marketing domain even when served on staging.

## Environment variables

Rate limiting uses the **Upstash REST convention only**
(`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`); a bare `REDIS_URL`
is intentionally NOT supported — one convention, no conflicting config.

Staging checklist:

```
NEXT_PUBLIC_SITE_URL=https://staging.operanto.ai
NEXT_PUBLIC_APP_URL=https://staging.operanto.ai     # combined-host mode
NEXT_PUBLIC_API_URL=https://api-staging.operanto.ai
AUTH_URL=https://staging.operanto.ai
DATABASE_URL= / DIRECT_URL=                          # Neon staging branch
AUTH_SECRET= / OPERANTO_ENCRYPTION_KEY= / CRON_SECRET=   # fresh, staging-only
PRONATONA_WEBHOOK_SECRET=                            # staging-only shared secret
PRONATONA_SOURCE_ORGANISATION_ID=                    # from the CONNECTED Pronatona DB
UPSTASH_REDIS_REST_URL= / UPSTASH_REDIS_REST_TOKEN=  # staging instance
RESEND_API_KEY= / EMAIL_FROM=                        # optional (dev-log fallback)
SENTRY_DSN= / NEXT_PUBLIC_SENTRY_DSN=                # optional
SEED_ADMIN_EMAIL= / SEED_ADMIN_NAME= / SEED_ADMIN_PASSWORD=  # for the seed run only
```

See `.env.example` for the complete annotated list. Production values:

```
NEXT_PUBLIC_SITE_URL=https://operanto.ai
NEXT_PUBLIC_APP_URL=https://app.operanto.ai
NEXT_PUBLIC_API_URL=https://api.operanto.ai
AUTH_URL=https://app.operanto.ai
DATABASE_URL=<Neon pooled>          DIRECT_URL=<Neon direct>
AUTH_SECRET / OPERANTO_ENCRYPTION_KEY / CRON_SECRET  ← openssl rand, per env
PRONATONA_WEBHOOK_SECRET=<shared with the Pronatona deployment>
PRONATONA_SOURCE_ORGANISATION_ID=<Organisation.id in the Pronatona DB>
UPSTASH_REDIS_REST_URL / _TOKEN     ← recommended in production (shared rate limits)
RESEND_API_KEY + EMAIL_FROM         ← invitation emails
SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN ← optional
```

## Deploy steps (per environment)

1. Provision the Neon database; set `DATABASE_URL`/`DIRECT_URL`.
2. `pnpm prisma db push` (first deploy; move to `prisma migrate` before
   schema changes reach production data).
3. Set all env vars; deploy; check `GET /api/health`.
4. `pnpm db:seed` (locally, pointed at that database) with `SEED_ADMIN_*`,
   `PRONATONA_WEBHOOK_SECRET`, `PRONATONA_SOURCE_ORGANISATION_ID` — creates
   the Pronatona organisation, the first admin, and the ACTIVE integration.
5. Add a scheduler for the retry sweep: Vercel cron (or external) hitting
   `POST /api/internal/events/retry` with `Authorization: Bearer $CRON_SECRET`
   every 5 minutes.
6. Sign in, invite real users (`/settings/users`), map Pronatona staff ids
   (`/integrations/pronatona`).

## Staging-first rollout (required order)

1. Local end-to-end (already scripted: `scripts/send-test-event.ts`).
2. Operanto staging DB → staging API/Cockpit deploy → seed.
3. Point the **Pronatona staging** dispatcher at
   `https://api-staging.operanto.ai/...` with the staging secret.
4. Run the acceptance journey on staging: one real `lead.created`; replay the
   same event (no duplicates); `lead.assigned`; `lead.status_changed`; failed
   signature; expired timestamp; disabled integration; unknown organisation;
   operator access boundaries; `pnpm build` green.
5. Only then configure the **production** Pronatona dispatcher with the
   production URL and a fresh secret. Never point production Pronatona at
   Operanto before the staging checklist passes.
