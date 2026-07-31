# Observability and email — preparation

Neither Sentry nor Resend is provisioned. Both boundaries exist in code, are
unit-tested, and no-op safely without credentials, so local development and CI
need none. This document is what the owner executes once credentials exist.

## Sentry

### What is already implemented

`src/lib/observability.ts` is the reporting boundary:

- `captureError(error, { scope, tags, extra })` — always logs locally, forwards
  only when `SENTRY_DSN` is set, and **never throws** (an observability failure
  must not become an outage).
- `releaseInfo()` — tags `environment` (`SENTRY_ENVIRONMENT` → `VERCEL_ENV` →
  `NODE_ENV`) and `release` (`SENTRY_RELEASE` → `VERCEL_GIT_COMMIT_SHA`), so
  the deployed commit is recorded and staging noise never masks production.
- `scrub()` — recursive redaction, unit-tested in `observability.test.ts`:
  - **secrets** (`[redacted]`): passwords, token/tokenHash, any `*secret*`,
    authorization, cookies, signatures, API keys, session/CSRF tokens
  - **personal data** (`[pii]`): name, email, phone (raw and normalized),
    message, inquiry text, summary, body
  - **raw inbound event payloads** (`rawPayload`, `payload`, `data`) are never
    forwarded — they carry the customer's name, email, phone and free text
  - bounded depth (6), array length (50) and string size (512) so a large or
    cyclic structure cannot be dumped
  - unknown class instances become `[unserialisable]` rather than being
    serialised blindly; `Error` is reduced to name + message, so properties
    attached to an error cannot smuggle data out

Wired in at event-processing failure and dead-letter creation
(`src/lib/events/process.ts`), with only safe correlation handles as tags:
event type, event id, attempt count, organisation id.

### Owner steps once DSNs exist

1. Create **two** Sentry projects: `operanto-staging` and `operanto-production`.
2. Install the SDK: `pnpm add @sentry/nextjs`.
3. Implement `sendToSentry()` in `src/lib/observability.ts` — it is the single
   hand-off point and already receives a fully scrubbed payload.
4. For browser capture, add the Next.js SDK config files and set
   `NEXT_PUBLIC_SENTRY_DSN`. Keep `sendDefaultPii: false`, and add a
   `beforeSend` that drops `request.data`, `request.cookies` and
   `request.headers.authorization` — defence in depth behind `scrub()`.
5. Set `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` per environment.
   On Vercel, `VERCEL_GIT_COMMIT_SHA` already provides the release.
6. Verify with the admin-only test error below, in staging first.

### Safe test-error mechanism

Not yet implemented. When added it must be: `POST /api/internal/test-error`,
guarded by `CRON_SECRET` (like the other internal routes) **and** refused when
`NODE_ENV === "production"` unless an explicit `ALLOW_TEST_ERROR=1` is set —
so a curious request can never manufacture production alerts.

### Alert recommendations

| Condition | Suggested rule |
|---|---|
| Repeated event-processing failures | `scope:events.process_failed` — more than 5 in 15 minutes |
| Dead-letter creation | `scope:events.dead_letter` — **any** occurrence; each one is an event that will never project without an admin |
| Authentication infrastructure outage | log/metric on `denied-fail-closed` from the rate limiter, or `/api/health/redis` non-200 — any occurrence, because it means sign-in is refusing everyone |
| Database connectivity failure | `/api/health/database` non-200 twice consecutively |
| Cron failure | no successful `/api/internal/events/retry` in 30 minutes (the schedule is every 5), or `/api/health/worker` reporting `stuck > 0` |

Vercel cron timing is best-effort, so alert on *absence over a window*, never
on an exact minute.

## Resend

### What is already implemented

`src/lib/email.ts` is the single provider boundary:

- `deliverInvitation({ to, organisationName, role, acceptUrl, expiresAt })`
  returns a discriminated `MailResult` — delivery is never assumed.
- The **raw token is used only to build the link**. Only its SHA-256 hash is
  stored (`Invitation.tokenHash`), and the raw value is never persisted.
- **Production never logs the link.** The console fallback is gated on
  `NODE_ENV !== "production"`; a misconfigured production deployment reports
  "not configured" instead of printing a usable invitation URL into logs.
- A failed send is recorded as failed: `Invitation.deliveredAt` stays null and
  `lastDeliveryError` holds the reason, so an administrator is never told a
  message is on its way when it is not. The Users screen shows
  "Sent …" / "Not delivered" / "Not sent yet".
- **Resend re-issues**: `resendInvitation()` mints a fresh token and revokes
  the previous invitation in one transaction, so two usable links never exist
  at once. Acceptance refuses revoked invitations.
- Account enumeration is avoided: invitation acceptance returns the same
  generic failure whether the token is unknown, expired, revoked or used, and
  the rate limiter's outage response says nothing about existence either.
- Development preview: outside production the accept URL is returned to the
  administrator's screen instead of only the log.

### Owner steps once credentials exist

1. Create the Resend API key and set `RESEND_API_KEY` and `EMAIL_FROM`
   (e.g. `Operanto <invitations@operanto.ai>`) per environment.
2. Verify the sending domain in Resend, then add the DNS records below.
3. Send one invitation to an address you control in staging and confirm the
   Users screen shows "Sent" with a timestamp.
4. Confirm production logs contain no invitation URL (grep the deployment logs
   for `/invite/`).

### DNS for `operanto.ai` (GoDaddy — records only, nameservers unchanged)

Resend supplies the exact values; the shapes are:

| Host | Type | Value | Purpose |
|---|---|---|---|
| `send` (or as instructed) | TXT | `v=spf1 include:amazonses.com ~all` | SPF for the sending subdomain |
| `resend._domainkey` | TXT | (long public key from Resend) | DKIM signing |
| `send` | MX | `feedback-smtp.<region>.amazonses.com` (priority 10) | bounce/complaint handling |

Prefer a **subdomain** sender (`send.operanto.ai`) so the apex SPF and any
future mailbox provider stay independent.

**Do not modify the existing `_dmarc` record** —
`v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net`
— without a reviewed mail-policy decision. It is already `p=quarantine` with
relaxed alignment, which works with a correctly configured SPF/DKIM sender.
Tightening to `p=reject` should only follow a period of clean DMARC reports.
