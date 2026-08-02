# Operanto channel foundation (Slice 5A)

The provider-neutral plumbing every live conversation channel will run on —
delivered with exactly one adapter (the deterministic simulator) and **no
external connectivity of any kind**: no Meta connection, no webhook route,
no outbound sending. Slice 5B adds the WhatsApp Cloud connector on top of
this foundation.

## Adapter contract (`src/lib/channels/types.ts`)

`ConversationChannelAdapter`: challenge verification, signature verification
against the RESOLVED connection (per-tenant secrets possible from day one),
event classification, tenant resolution (`connectionRef` — null means
REJECT, never a fallback lookup), provider idempotency (`dedupeKey`),
normalization to `NormalizedChannelEvent` (message | delivery status), and
the Slice 5B contracts `sendMessage` (throws in every 5A adapter) and
`verifyConnection`. The registry (`registry.ts`) denies by default: MANUAL
deliberately has no adapter — manual messages are records, never
transmissions.

## Ingestion pipeline (`src/lib/services/channel-ingest.ts`)

Store-then-process, mirroring the proven `InboundEvent` design:

```text
storeChannelPayload: classify → resolve tenant (exact; reject otherwise)
  → ChannelInboundEvent (unique [connectionId, dedupeKey]) → health stamp
processChannelInboundEvent: atomic claim (RECEIVED/FAILED, attempts < 5)
  → normalize → project (identity ladder → conversation upsert by thread
  → Message insert by constraint → consent keywords → activities)
  → PROCESSED | FAILED (retry) | DEAD_LETTER (audited)
retryPendingChannelEvents: FAILED + stale rows, on the existing 5-min cron
```

Identity resolution is the channel ladder from Slice 2 — taught
`CustomerIdentity` → exact e-mail → unlinked; erased tombstones are never
re-matched. All processing runs with SYSTEM authority, organisation-scoped
through the resolved connection.

## Consent (`Consent` model, `consent-keywords.ts`, `services/consent.ts`)

Per-customer, per-channel: `UNKNOWN / OPTED_IN / OPTED_OUT`, with provenance
(`inbound_keyword` | `manual`). Deliberate short-message STOP/START keywords
(with Albanian equivalents) update it from the pipeline; manual corrections
require `consent:manage` (ADMIN + SUPERVISOR) and are audited. Consent rows
are compliance evidence — kept through erasure and retention. **Every future
outbound send must check this record**; nothing in 5A sends.

## Delivery-status state machine (`src/lib/channels/delivery.ts`)

Monotonic: `RECORDED → QUEUED → SENT → DELIVERED → READ`, `FAILED` reachable
from pre-terminal states; late/duplicate provider webhooks can never regress
a status (conditional update, no read-then-write race). `RECORDED` is frozen
— the local/unsent invariant from Slice 4 is now enforced by the machine
itself: no transition out of RECORDED exists in 5A.

## Connection health

`ChannelConnection` gains `lastReceivedAt / lastSuccessfulAt / lastErrorAt /
lastError`, stamped by the pipeline and shown on the Integrations page
(`channels:manage`, ADMIN).

## Privacy

Raw channel payloads carry the customer's verbatim words: erasure redacts
them via the event's `conversationId` anchor, and additionally scans the
organisation's unattributed (never-projected, e.g. dead-lettered) events for
the erased identity keys, so a dead letter cannot shelter identifying
content. The retention sweep redacts ALL payloads after
`OPERANTO_PAYLOAD_RETENTION_DAYS` (30 days) — FAILED/DEAD_LETTER rows keep
theirs for replay only within that window; no dead-letter row retains a raw
payload indefinitely. The operational shell (status, attempts, error,
timestamps) survives, content-minimised. Both sweeps run on the existing
cron.

## Simulator

`ingestSimulatedMessage` is now a thin driver over the canonical pipeline —
same public contract, same determinism, same guards — so every test that
exercises the simulator exercises the real ingestion path end to end.

## Migration

`20260802133507_channel_foundation` — additive only: `ChannelInboundEvent`,
`Consent`, connection health columns, `Message.statusUpdatedAt` +
`Message.errorMessage`. Tenancy-scoped uniqueness throughout; clean-install
and upgrade replays verified.

## Deferred to Slice 5B

The public webhook route, Meta app + per-org WABA credentials (encrypted),
signature verification against live secrets, template and 24-hour-window
enforcement, the explicit outbound send operation with its full recheck
chain, delivery receipts from a real provider, attachments, and the feature
flag for live traffic.
