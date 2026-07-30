# Operations runbook

## Integration health

`/integrations/pronatona` (ADMIN) shows: integration status, last
received/success/error, counts per processing state, event types, recent
events with errors, per-event retry, secret rotation, staff mappings. The
dashboard surfaces failed-event and unassigned counts.

## Failed-event recovery

1. Open `/integrations/pronatona` → the failing event shows its `lastError`.
2. Transient cause (DB hiccup, out-of-order dependency): press **Retry** — or
   wait; the cron sweep (`POST /api/internal/events/retry`, CRON_SECRET)
   retries every FAILED event with attempts remaining and rescues rows stuck
   in RECEIVED/PROCESSING for >10 min.
3. `DEAD_LETTER` (5 failed attempts): fix the cause first. Retry resets the
   attempt counter — an explicit admin decision, audited
   (`integration.event_retried`).
4. Schema-invalid events are rejected at receipt (400) and never stored; the
   Pronatona side keeps them in ITS outbox (retrying → dead-letter), so
   nothing is lost — recover on the producer side.
5. Handlers are idempotent: re-processing a half-projected event completes it
   without duplicates.

## Webhook secret rotation

1. Generate: `openssl rand -hex 32`.
2. Operanto `/integrations/pronatona` → *Secret rotation* → paste; takes
   effect immediately (audited, ciphertext at rest, never displayed).
3. Update `OPERANTO_WEBHOOK_SECRET` in the Pronatona deployment and redeploy.
4. Between the two steps deliveries fail with 401 and retry with backoff —
   nothing is lost; rotate during a quiet window and run "Dispatch now" on the
   Pronatona side afterwards.

Rotate `OPERANTO_ENCRYPTION_KEY` only with a migration that re-encrypts
stored secrets (not yet automated — re-enter the webhook secret after
changing the key).

## Session / account incidents

- Suspected account compromise: `/settings/users` → **Revoke sessions**
  (instant, all devices), then **Suspend** if needed.
- Departed staff: Suspend the membership; historical activity is retained.
- Suspension in Pronatona does NOT auto-suspend Operanto (deliberate — see
  event-schema.md); the timeline records `staff.suspended` so admins act.

## Monitoring checklist

- `GET /api/health` (DB connectivity) — wire into uptime monitoring.
- Dashboard "Failed integration events" > 0 → investigate.
- Pronatona `/admin/integrations`: pending depth should return to ~0 after
  each cron run; dead-letter > 0 needs attention on the producer side.

## Production rollout checklist

- [ ] Staging checklist (deployment.md) fully green, including replay and
      access-boundary tests
- [ ] Fresh production secrets (AUTH, encryption, webhook, cron) — different
      from staging
- [ ] Seed run against production DB; admin sign-in verified
- [ ] Staff mappings entered for every active Pronatona agent
- [ ] Retry cron configured and firing (check audit log for `event.*`)
- [ ] Pronatona production dispatcher enabled last
- [ ] First real lead verified end-to-end in the production cockpit
