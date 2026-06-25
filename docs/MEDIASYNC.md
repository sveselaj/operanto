# MediaSync — Operanto's communication layer

> One product. One brand. One business outcome.
> **Operanto is the product. MediaSync is part of its engine.**

MediaSync is an **embedded module inside Operanto**, not a separate product. It
owns the communication layer — everything between a customer's channel and
Operanto's vertical AI-qualification + workflow engine.

```
Customer channels
WhatsApp · Email · Instagram · Webchat · Messenger · SMS
                    ↓
               OPERANTO
   ┌─────────────────────────────────────┐
   │ MediaSync communication layer       │
   │  • Channel connectors               │
   │  • Unified inbox intake             │
   │  • Customer identity resolution     │
   │  • Conversation history             │
   │  • Attachments                      │
   │  • Human takeover                   │
   │  • Routing and assignment           │
   │  • Consent and message status       │
   └─────────────────────────────────────┘
                    ↓
   AI qualification and workflow engine
                    ↓
 Quotes · CRM · Calendar · ERP · Approvals
```

It is the descendant of the standalone *MediaSyncHub* prototype, folded into
Operanto so customers buy and learn **one** product.

## Where the code lives

| Concern | Location |
|---|---|
| Connector contract (verify, normalize, status, send) | `src/lib/channels/types.ts` |
| Provider connectors (WhatsApp/Messenger/Instagram, Telegram, Viber/SMS) | `src/lib/channels/providers/` |
| Connector env config | `src/lib/channels/config.ts` |
| Credential encryption (AES-GCM) | `src/lib/mediasync/crypto.ts`, `channel-credentials.ts` |
| Identity resolution (phone normalize, match, merge) | `src/lib/mediasync/identity.ts`, `phone.ts` |
| Consent / opt-out (incl. STOP/START keywords) | `src/lib/mediasync/consent.ts`, `consent-keywords.ts` |
| Delivery status lifecycle | `src/lib/mediasync/delivery.ts` |
| Reusable outbound templates | `src/lib/mediasync/templates.ts`, `templates-render.ts` |
| Raw webhook intake (idempotency + replay) | `src/lib/mediasync/webhook-events.ts` |
| Connector observability (sync jobs) | `src/lib/mediasync/sync.ts` |
| Human takeover | `src/lib/mediasync/takeover.ts` |
| Diagnostics (test-send + receive check) | `src/lib/mediasync/diagnostics.ts` |
| Rate limiting (webhook intake) | `src/lib/mediasync/rate-limit.ts` |
| Ingestion pipeline (ties it together) | `src/lib/services/ingestion.ts` |
| Public webhook endpoint | `src/app/api/webhooks/[channel]/route.ts` |

`src/lib/mediasync/index.ts` re-exports the whole module (including channels) as
a single import surface: `import { canSend, resolveCustomer } from "@/lib/mediasync"`.

## Data model

MediaSync adds to `prisma/schema.prisma`:

- **Message**: `status` (`queued|sent|delivered|read|failed`), `statusUpdatedAt`,
  `errorMessage`, `templateId`.
- **Conversation**: `handling` (`ai|human`), `takenOverByUserId`, `takenOverAt`.
- **Customer**: `phoneNormalized` (E.164 for matching), `mergedIntoId` (merge chain).
- **Workspace**: `aiAutoReplyEnabled`, `dataRetentionDays`.
- **Consent**, **MessageTemplate**, **WebhookEvent**, **SyncJob** models.

## Request flow (inbound)

1. `POST /api/webhooks/{channel}` — rate-limited per channel+IP.
2. Connector verifies signature; raw event persisted via `recordWebhookEvent`
   (deduplicated by provider event id).
3. `classifyEvent` splits **message** vs **delivery status**.
   - message → `ingestInbound`: resolve identity, honor STOP/START consent
     keywords, idempotently append the message, fire automations.
   - status → `applyStatusUpdate`: advance the outbound message's delivery state.
4. The webhook event is marked `processed` / `duplicate` / `failed`.

## Outbound send

`sendReply` (and template sends) check `canSend` (consent gate) before
delivering, set the message's initial `status`, and flip the conversation to
`human` handling — Operanto's rule is *AI suggests, human approves* unless the
workspace enables AI autonomy (`aiAutoReplyEnabled`).

## Live connectors

Real provider connectors are implemented behind the `Channel` contract:

| Channel | Verify (inbound) | Send |
|---|---|---|
| WhatsApp (Cloud API) | hub.* handshake + X-Hub-Signature-256 (HMAC, `META_APP_SECRET`) | Graph `/{phone_number_id}/messages` |
| Messenger | hub.* + X-Hub-Signature-256 | Graph `/me/messages` (Send API) |
| Instagram | hub.* + X-Hub-Signature-256 | Graph `/me/messages` |
| Telegram | `X-Telegram-Bot-Api-Secret-Token` | `api.telegram.org/bot…/sendMessage` |
| Viber (Infobip) | `X-Webhook-Secret` | Infobip `/viber/2/messages` |
| SMS (Infobip) | `X-Webhook-Secret` | Infobip `/sms/2/text/advanced` |

Each degrades safely (rejects inbound, refuses to send) until its env/account
credentials are set. App-level secrets come from env (`.env.example`); per-account
send tokens are stored encrypted via **Settings → Channel credentials**. The
webhook route resolves the receiving `ChannelAccount` (and tenant) from the
provider account id (`phone_number_id` / page id / sender), so one Meta app or
Infobip account fans out to many workspaces.

## Roadmap (not in this pass)

Email (SMTP/IMAP) remains a stub; AI auto-tagging, moderation and smart-reply
extend the AI layer; Posts/Comments (public social) management is deferred.
