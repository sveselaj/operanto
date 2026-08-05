# Telephony connection settings (OI voice — slice 1)

Status: delivered on `feature/oi-3-crm-foundation`. The settings surface is
deliberately NOT env-flag-gated — admins manage the connection entirely in
the app (Integrations → Telephony); `OPERANTO_VOICE_ENABLED` is reserved for
the future RUNTIME (dialing/webhooks). Settings only — **no telephony
behavior ships in this slice**: no adapter, no webhook route, no dialing.
A stored connection does nothing until the provider adapter (calling slice /
OI-8) consumes it.

## What ships

- **`TelephonyConnection`** (additive migration): per-organisation,
  provider-neutral connection record. Credentials (`apiKey`, `apiSecret`)
  AES-256-GCM-encrypted under `OPERANTO_ENCRYPTION_KEY` before they touch the
  database; never returned by any read path; never in audit metadata
  (integration-tested). A webhook signing secret is generated server-side at
  connect time, stored encrypted, and **shown exactly once** for the
  provider's webhook configuration. Stage gates `inboundEnabled` /
  `outboundEnabled` both default OFF (connect → verify → inbound → outbound,
  the WhatsApp activation pattern).
- **Provider catalog** (`src/lib/telephony-providers.ts`): the single source
  of truth for which credential fields each provider needs — CloudTalk,
  Aircall, JustCall, Ringover, sipgate, Placetel, Twilio, 3CX, plus a
  generic entry. The settings form renders exactly the catalog's fields; the
  service validates the same list. Adding a provider = one catalog entry
  (+ later its adapter).
- **Service** (`src/lib/services/telephony.ts`): list / connect / stage-gates
  / disconnect. Admin-only (`channels:connect` to save credentials,
  `channels:manage` to administer), tenant-scoped, audited
  (`telephony.connection_saved`, `.stage_gates_updated`,
  `.connection_disabled` — ids and provider name only).
- **UI**: "Telephony" section on `/integrations` (visible only with the flag
  on AND `channels:manage`): existing connections with status/gates/health +
  the provider-adaptive connect form.
- **Tests**: `test/telephony.integration.test.ts` — flag gate, admin-only,
  per-provider validation, encryption at rest + decrypt round-trip, no
  credential leakage into list/audit surfaces, tenant isolation, gates,
  disconnect.

## What is deliberately NOT here

Dialing, call events, webhook receipt, transcript/recording retrieval, and
lead matching. Those arrive as the calling slice implementing the
`packages/crm-voice` contracts (`CallProvider`, `VoiceProvider`,
`TranscriptProvider`, `RecordingProvider`) against the confirmed provider,
with the webhook route built on the store-then-process pipeline and verified
against the stored signing secret.

## Operational note

The organisation's real phone system is currently unlinked (calls leave no
trace in the CRM). Once the provider is confirmed, the activation order is:
admin saves the connection in Settings → Integrations (API key from the
provider's admin console; in-app setup guide on the page) →
adapter slice ships → inbound gate on (calls/voicemails appear on leads) →
outbound gate on (click-to-call). No credentials ever travel through chat,
tickets, or commits — only the settings form.
