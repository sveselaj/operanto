# Event schema — Pronatona → Operanto

Endpoint: `POST /api/v1/integrations/pronatona/events`
(production `https://api.operanto.ai/...`, staging `https://api-staging.operanto.ai/...`).

## Transport

Required headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Operanto-Event-Id` | must equal `eventId` in the body |
| `X-Operanto-Timestamp` | unix seconds, decimal string |
| `X-Operanto-Signature` | `hex(HMAC_SHA256(secret, timestamp + "." + rawBody))` |

The signature covers the exact raw request body. Operanto verifies with a
timing-safe comparison and rejects timestamps outside ±300 s. Maximum body
size: 256 KB.

Responses:

| Status | Meaning |
|---|---|
| `202` | newly accepted; processed asynchronously |
| `200` + `duplicate:true` | event id already received — safe to mark delivered |
| `400` | malformed JSON / envelope, or header–body event-id mismatch |
| `401` | missing headers, invalid signature, or timestamp outside window |
| `403` | integration disabled |
| `409` | signed correctly but claims a different source organisation |
| `413` | payload too large |
| `429` | rate limited |

The dispatcher treats `2xx` as delivered and anything else as retryable
(except that repeated failures dead-letter after 8 attempts).

## Envelope (schemaVersion 1)

```json
{
  "eventId": "c6d8f846-21e7-40d7-aa1e-3170356c7974",
  "eventType": "lead.created",
  "schemaVersion": 1,
  "occurredAt": "2026-07-30T09:30:00.000Z",
  "source": "PRONATONA_WEB",
  "organisationId": "<Pronatona organisation id>",
  "correlationId": "<lead id>",
  "actor": { "type": "CUSTOMER", "userId": null, "membershipId": null },
  "data": { ... }
}
```

`actor.type` ∈ `CUSTOMER | STAFF | SYSTEM | CONNECTOR`. The envelope is
validated strictly (unknown top-level fields are stripped — the contract
carries **no roles or permissions**, and Operanto would ignore them if it
did). `data` payloads are validated tolerantly per event type: unknown extra
fields are allowed so additive producer changes do not break ingestion.

## Event types and payloads

### `lead.created` / `viewing.requested`

```json
{
  "leadId": "…",
  "inquiryType": "PROPERTY_QUESTION | VIEWING_REQUEST | SELL_PROPERTY | GENERAL_INQUIRY",
  "sourceChannel": "website | facebook | instagram | …",
  "customer": { "name": "…", "email": null, "phone": "…", "preferredLanguage": "sq", "preferredChannel": "WHATSAPP" },
  "message": "inquiry text",
  "preferredDate": "2026-08-02T00:00:00.000Z",
  "propertyId": "…", "propertyReference": "PRN-…",
  "property": { "id", "referenceCode", "title", "status", "price", "currency", "city", "publicUrl", "thumbnailUrl" },
  "assignedAgentId": "…",
  "sourceChannel": "website"
}
```

Projection: find-or-create customer (see `customer-matching.md`) → upsert
opportunity keyed on `(organisation, PRONATONA_WEB, leadId)` → upsert property
context from the embedded snapshot → activities (`inquiry.received`,
`customer.created|matched`, `opportunity.created`, `property.attached`) →
follow-up task (`OPERANTO_FOLLOWUP_SLA_HOURS`, default 4 h) once per
opportunity. A viewing request also moves the stage to `VIEWING_REQUESTED`.

### `lead.assigned` / `viewing.assigned`

`{ "leadId", "assignedAgentId", "previousAssignedAgentId" }` — resolves the
Pronatona staff id through the admin-maintained staff mapping; unmapped
assignees are recorded as `assignment.unmapped` activity instead of failing.

### `lead.status_changed`

`{ "leadId", "status", "previousStatus" }` — stage mapping `NEW→NEW`,
`CONTACTED→QUALIFYING`, otherwise 1:1; the verbatim source status is always
preserved in `Opportunity.sourceStage`. Operanto never writes lead status back
to Pronatona in this release.

### `property.published` / `property.updated` / `property.status_changed`

Property snapshot at top level (same shape as the embedded `property` above,
plus `from`/`to` for status changes). Upserts `PropertyContext`;
`property.status_changed` additionally adds a flag activity on every open
opportunity linked to that property.

### `staff.activated` / `staff.suspended`

`{ "userId", "email", "name", "role" }` — recorded as activity + audit only.
Operanto memberships are invitation-only and admin-driven; a source-system
event never grants, suspends, or deletes Operanto access, and historical
activity is always retained. Unknown event types are accepted, stored, and
marked ignored (forward compatibility).
