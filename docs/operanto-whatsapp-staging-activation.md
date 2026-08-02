# WhatsApp staging activation runbook

Operational companion to `docs/operanto-whatsapp-cloud.md`. Executes the
approved activation order on staging. **Prerequisites (provided by the
product owner, never invented or committed):** `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`, staging WABA id, staging/test phone number +
phone-number id, system-user access token, and the approved test numbers.

Rules in force throughout: both feature flags stay OFF during
configuration; outbound is enabled only after inbound results are reported
AND approved; testing only against approved test numbers; outbound is
disabled again after the pilot unless continued staging use is explicitly
approved.

## Phase 0 — configure (flags off)

1. Set in Vercel (project `inovativi/operanto`, **Preview/staging env
   only**): `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`. Do NOT set
   either `OPERANTO_WHATSAPP_*` flag yet. Redeploy staging.
2. Probe: `POST https://api-staging.operanto.ai/api/webhooks/whatsapp`
   → expect **404** (route dark). `GET` with valid hub params → 404 too.

## Phase 1 — webhook subscription + inbound flag

3. Set `OPERANTO_WHATSAPP_INBOUND_ENABLED=1` (staging only), redeploy.
4. In Meta App Dashboard → WhatsApp → Configuration: callback URL
   `https://api-staging.operanto.ai/api/webhooks/whatsapp`, verify token =
   `META_WEBHOOK_VERIFY_TOKEN`, subscribe to `messages`. Meta performs the
   GET handshake; confirm it succeeds.
5. Negative probes: GET with a wrong token → 403; POST unsigned `{}` →
   401; POST signed garbage → 200 `{ignored:"unclassified"}`.

## Phase 2 — connect the WABA (cockpit)

6. As a staging ADMIN: Integrations → *Connect WhatsApp Cloud* → WABA id,
   phone-number id, display number, access token → expect "Connection
   saved and verified" (proves token + number ownership via Graph).
7. Enable **inbound only** on the connection row (leave outbound off).

## Phase 3 — inbound test matrix

Send from the approved test number(s) to the staging number; verify in the
cockpit and via read-only DB checks (`scripts/tmp-*.ts` pattern, cleaned up
afterwards). Every check maps to an already-tested code path — staging
validates configuration, not logic.

| # | Test | Expected |
| --- | --- | --- |
| 1 | Plain text message | Event PROCESSED; conversation + message visible; connection health stamped (`lastReceivedAt`/`lastSuccessfulAt`). |
| 2 | Authoritative routing | Event's organisation = the connection's org; a signed payload naming an unknown `phone_number_id` → 200 `{ignored:"unresolvable_tenant"}`, no rows. |
| 3 | Exact sender identity | Participant `externalRef` = `wa:<wa_id>`; no email/phone guessing. |
| 4 | New customer | Conversation arrives UNLINKED. Link via cockpit → `CustomerIdentity` row `wa:<wa_id>` created. |
| 5 | Previously taught customer | Second message from the same number on a fresh thread auto-links the same customer. |
| 6 | Duplicate webhook | Redeliver an identical payload (Meta retry or manual signed replay) → stored-once duplicate, single Message. |
| 7 | STOP / START | Deliberate `STOP` → consent OPTED_OUT for that org only, activity recorded; `START` → OPTED_IN. |
| 8 | Restriction | Restrict the linked customer → subsequent AI runs refuse (existing behaviour); inbound recording continues; unrestrict. |
| 9 | Erasure | Erase a throwaway linked customer → identity deleted, payloads redacted via anchor, messages redacted, fresh thread from the same number stays unlinked. |
| 10 | Retry / dead letter | Confirm zero FAILED/DEAD_LETTER events from the session (`ChannelInboundEvent` status counts); the sweep endpoint reports cleanly. (Forcing a real dead letter on staging is not required — path is integration-tested.) |
| 11 | Media | Send an image with caption + a PDF → messages show caption/empty body with visible `media_pending` chip; metadata has provider media id + mime only, no URLs/tokens. |
| 12 | Unsupported media | Send a sticker and a reaction → no message projected; event IGNORED; nothing crashes. |
| 13 | Outbound impossibility | With outbound still disabled: no send panel renders; a forged send attempt refuses at the deployment-flag gate (first check, before any provider code); grep staging logs for zero `graph.facebook.com` POSTs. |

**Report the Phase 3 results and STOP. Outbound flags change only after
explicit approval of the inbound report.**

## Phase 4 — outbound pilot (after inbound approval only)

8. Set `OPERANTO_WHATSAPP_OUTBOUND_ENABLED=1` (staging), redeploy; enable
   outbound on the designated connection ONLY.
9. Matrix (approved test numbers only):
   - explicit human send from the panel → Graph call → SENT with
     `providerMessageId`;
   - AI draft approved as RECORDED → confirm zero provider calls and the
     RECORDED row never changes state;
   - STOP first → send refused (`opted out`); START to restore;
   - restricted customer → send refused; unrestrict;
   - fresh conversation, then wait/simulate window expiry (temporarily age
     `lastInboundAt` on a throwaway staging conversation) → free text
     refused, PENDING template refused, APPROVED template + OPTED_IN sends;
   - double-submit the same idempotency key → exactly one Graph call;
   - real device: observe sent/delivered/read callbacks advance the
     message monotonically; replay an old `sent` callback → no regression;
   - force one failure (e.g. temporarily invalid token) → FAILED with
     normalized category (no provider body), explicit Retry send succeeds
     after restoring the token;
   - audit: `message.sent` / `message.send_failed` metadata is ids-only;
     Activity shows `conversation.outbound_sent`;
   - erasure/retention: erase the pilot customer → messages redacted;
     confirm payload sweep covers the session's events.
10. **Disable outbound again** (both the connection gate and, unless
    continued use is approved, the deployment flag). Clean up pilot
    fixtures. Report.
