# Operanto WhatsApp Cloud integration (Slice 5B)

The first live channel connector, built on the Slice 5A foundation: one
Operanto-managed Meta application, each Organisation connecting its **own**
WhatsApp Business Account (WABA) and phone number. All provider-specific code
lives behind `ConversationChannelAdapter`; nothing outside
`src/lib/channels/whatsapp-adapter.ts` speaks Meta.

## Architecture

| Concern | Where | Rule |
| --- | --- | --- |
| Webhook entry | `src/app/api/webhooks/whatsapp/route.ts` | The ONE public Meta surface. Flag → rate limit → size → signature → parse → store → 200 → process after response. |
| Signature | adapter `verifySignature` | `X-Hub-Signature-256` HMAC-SHA256 over the raw body with the deployment-level `META_APP_SECRET`, timing-safe, **before any tenant data processing**. Fails closed when unset. |
| Handshake | adapter `verifyChallenge` | `hub.verify_token` vs `META_WEBHOOK_VERIFY_TOKEN`, timing-safe. |
| Tenant routing | `storeChannelPayload` | ONLY by the receiving number's `phone_number_id` against an ACTIVE, inbound-enabled connection. Globally unique by constraint (`@@unique([type, phoneNumberId])`). No first-match, no fallback, no default org; the SENDER's number is never a tenant key; ambiguous payloads reject. Unknown routing is acknowledged (200) and logged content-minimised (the ref only). |
| Pipeline | `ChannelInboundEvent` | The canonical store-then-process path from 5A: constraint dedupe (`wa:`-prefixed key over message/status ids), atomic claims, bounded retries, dead-letter, cron sweep. |
| Identity | identity ladder | Sender identity is exactly `wa:<wa_id>`. Taught only by explicit linking; withdrawn on unlink; deleted on erasure; tombstones never re-matched. |
| Consent | 5A Consent model | STOP/START (and ndalo/fillo etc.) on deliberate messages; scoped per (organisation, customer, WHATSAPP). |
| Delivery states | `shouldAdvance` | `RECORDED → QUEUED → SENDING → SENT → DELIVERED → READ`, FAILED reachable pre-terminal. Monotonic and idempotent: late/duplicate provider callbacks never regress. RECORDED never transitions — it is permanently local and unsent. |

## Credentials and configuration

Per-organisation `ChannelConnection` rows store: `wabaId`, `phoneNumberId`,
`displayPhoneNumber`, `accessTokenEncrypted` (AES-256-GCM under
`OPERANTO_ENCRYPTION_KEY`), `tokenExpiresAt`, `lastVerifiedAt`, health stamps,
and the two stage gates. **No plaintext token, app secret, verification token
or phone credential is ever stored**; tokens are decrypted only inside the
adapter's send/verify calls and never returned, logged or audited. The Meta
app secret and webhook verify token are deployment-level environment values
because the Meta application is Operanto-managed.

Connecting a number (`channels:connect`, ADMIN) refuses to claim a
`phone_number_id` already registered to another workspace, verifies token +
number ownership against the provider, and audits identifiers only.

## Feature flags and activation order

Four separate server-side controls; outbound defaults OFF at both levels:

1. `OPERANTO_WHATSAPP_INBOUND_ENABLED=1` — deployment inbound (webhook route).
2. `OPERANTO_WHATSAPP_OUTBOUND_ENABLED=1` — deployment outbound (send op).
3. `ChannelConnection.inboundEnabled` — per-organisation inbound stage gate.
4. `ChannelConnection.outboundEnabled` — per-organisation outbound stage gate.

Activation order: connect → verify → webhook handshake → inbound-only staging
→ delivery callbacks → controlled outbound to test numbers → limited pilot →
production only after explicit approval.

`META_GRAPH_BASE_URL` overrides the Graph host for tests and staging
sandboxes and is honoured ONLY outside production (same environment policy as
the rate-limit namespace); production always uses `graph.facebook.com`.

## Explicit outbound — the send invariant

`sendWhatsAppMessage` (`src/lib/services/whatsapp-send.ts`) is the one path
to external transmission, and it is an explicit human operation. **No AI
approval, Task, workflow event, cron or background process invokes it.**
Approving an AI draft records a local RECORDED message and nothing more; a
RECORDED message never transitions and is never transmitted — the send
operation creates a NEW outbound message starting at QUEUED.

Every send re-runs the full server-side recheck chain at the moment of the
attempt (UI state is advisory only): deployment flag → permission
(`messages:send`) → active organisation → record-level conversation access →
not archived → connection type/status/stage-gate/WABA + phone ownership/
credential presence + expiry → recipient taken from the conversation's own
participant identity (never caller-supplied) → erasure → restriction →
consent → the 24-hour service window recalculated server-side
(`serviceWindowState`, opened by the last inbound customer message) →
organisation-authorized APPROVED template required outside the window
(selected by id from `MessageTemplate`, never a client-provided name; opt-in
consent required for out-of-window template sends) → idempotency (unique
`(organisationId, clientDedupeKey)` claimed BEFORE the provider call) →
conditional `QUEUED→SENDING` claim as the duplicate-send lock → provider call
→ `SENT` or `FAILED` with a normalized error category (provider response
bodies are never logged or persisted).

A FAILED send is retried only through `retryWhatsAppSend` — explicit, human,
idempotent (conditional `FAILED→SENDING` claim, the one sanctioned FAILED
exit; provider callbacks cannot leave FAILED), and it re-runs the recheck
chain, reusing the original template identity from the message record.

## Attachments (first-release policy)

No `[image]`-style string replacement. Text is projected fully; **image,
document, audio and video** messages persist SAFE METADATA ONLY — provider
media id, mime type, filename, caption — in `Message.metadata` with a visible
`media_pending` state in the cockpit until binary retrieval ships. Locations
are rendered as text coordinates. **Unsupported and not projected**:
stickers, reactions, interactive replies, contacts. Provider media URLs and
access tokens are never stored anywhere, and never appear in audit metadata.

## Privacy

Raw webhook payloads live in `ChannelInboundEvent` and inherit the 5A
lifecycle: 30-day payload retention for ALL statuses (dead letters keep
payloads for replay only within the window), erasure by conversation anchor
plus the unattributed-event identity scan, restriction pausing disposal,
audit metadata ids-only. WhatsApp identities are `CustomerIdentity` rows —
deleted on erasure, tombstones never re-matched. Outbound message bodies are
ordinary `Message` rows under per-organisation message retention.

## Permissions (3-role model, no new roles)

- `channels:connect` — ADMIN. Store/replace a connection credential.
- `channels:manage` — ADMIN (existing). Stage gates, verification, health.
- `messages:send` — ADMIN, SUPERVISOR, OPERATOR. Necessary, never
  sufficient: record-level access and the recheck chain govern each send.
- `templates:manage` — ADMIN, SUPERVISOR. Template administration.

## Testing

- Unit: signature vectors, handshake, routing/ambiguity, normalization
  (text/media/location/unsupported/statuses), dedupe determinism, Graph host
  production guard, send preconditions, service-window boundary cases.
- Integration (real PostgreSQL, mocked `fetch` for Graph): routing to exactly
  one tenant, no-fallback rejections, duplicate webhooks, identity teaching
  and tombstones, tenant-scoped STOP/START, erasure, encrypted credentials,
  stage gates, and the full outbound matrix (both-level default-off, allowed
  send, duplicate-send, window/template/consent refusals, cross-tenant and
  unassigned-operator denials, monotonic callbacks, provider-failure
  normalization + explicit retry, manual flows unaffected).
- E2E (Playwright): the REAL webhook route with genuinely signed payloads and
  a local mock Graph server via the non-production `META_GRAPH_BASE_URL`
  override — handshake, signature enforcement, connection setup through the
  cockpit, both product journeys (Nagelista shipping enquiry, Pronatona
  property enquiry), approval-vs-send separation, delivery callbacks,
  STOP refusal. **No live Meta connectivity is required for CI.** Live
  verification against Meta's test environment uses designated test numbers
  and is a deployment activity, not a CI dependency.

## Known limitations

- Media binaries are not retrieved yet (`media_pending`); retrieval with
  explicit retention/erasure is follow-up work.
- Templates are mirrored manually from Meta Business Manager (no sync API);
  template BODY parameters are not yet supported — fixed-body templates only.
- Consent keywords attach only to linked customers (5A rule); an opt-out from
  a never-linked sender blocks nothing until linking. Out-of-window template
  sends to unlinked conversations are refused (no consent record can exist).
- Token expiry is honoured when set but Meta system-user tokens are typically
  non-expiring; rotation is manual via reconnect.
- Provider rate/usage policy is enforced by Meta per WABA; Operanto adds its
  own webhook rate limit but no outbound throughput shaping yet.
