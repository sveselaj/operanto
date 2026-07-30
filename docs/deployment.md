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

## Environment variables

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
