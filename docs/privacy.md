# Privacy: erasure, restriction, retention

Operanto holds a **projection** of personal data that originates in a source
system. Pronatona is the controller's system of record; Operanto is a second
copy. That has one consequence that governs everything below: **a request from
a data subject must be executed in both systems**, and doing it in only one is
not compliance, it is a false record of compliance.

## What personal data Operanto holds

| Where | What |
|---|---|
| `Customer` | name, email, phone (plus normalized matching keys), preferred language and channel |
| `Opportunity` | `inquiryText` — the customer's own words — and `summary` derived from it |
| `Activity` | human-readable summaries and a `metadata` JSON that can carry the message and identity fields |
| `Task` | `description`, seeded from the customer's message |
| `InboundEvent.rawPayload` | a **verbatim copy of the whole original event**, including name, email, phone and free text |
| `AuditEvent` | who did what; deliberately never the personal values themselves |

The raw event payload is the surface people forget. It exists so a failed
event can be replayed and debugged, and it holds everything.

## Erasure (GDPR Art. 17)

`/customers/<id>` → **Privacy** → *Erase personal data*. Requires the
`privacy:manage` permission (ADMIN only), a reason that is recorded, and the
word `ERASE` typed to confirm.

**Erasure redacts in place; it does not delete rows.** Deleting the customer
would cascade away the opportunities, the timeline and the evidence that the
erasure happened — which is exactly what you need in order to demonstrate
compliance. What survives is a tombstone: an inquiry existed, it reached a
stage, and it was erased on a date. No personal data.

It covers the customer record (including the matching keys, so nobody can be
re-attached to the tombstone), inquiry free text, activity summaries and
metadata, task descriptions, and the raw payloads of the originating events —
whose `correlationId` is also cleared, because that lead id is the key that
leads back to the person in Pronatona.

Customer matching skips erased records, so a later event creates a fresh
customer rather than repopulating the tombstone.

### Cross-system procedure — do all of it

1. Record the request (who asked, when, how they were identified).
2. **Pronatona**: erase the lead and any notes. Pronatona is the system of
   record; if it still holds the data, nothing has been erased.
3. **Operanto**: run the erasure above. Note the audit entry id.
4. If the person also messaged on a channel not yet integrated (WhatsApp, a
   personal inbox), erase there too.
5. Confirm to the person, referencing both systems.

Operanto does **not** currently receive an erasure event from Pronatona, and
Pronatona does not receive one from Operanto. Step 2 and step 3 are both
manual. Automating this is the obvious next improvement and should happen
before the volume makes manual erasure unreliable.

## Restriction of processing (GDPR Art. 18)

Same panel, *Restrict processing*. The data is retained; the record is flagged
wherever it is displayed so nobody contacts the person or acts on it while a
dispute or verification is open. Reversible, and both directions are audited.

## Retention of raw event payloads

Raw payloads are redacted **30 days** after receipt by default
(`OPERANTO_PAYLOAD_RETENTION_DAYS`), leaving only the envelope: event id, type,
schema version, timing, source and correlation id. Only `PROCESSED` events are
touched — a failing or dead-lettered event may still need its payload to be
recovered, so those are left alone until they succeed.

The sweep runs inside the existing retry cron rather than on a schedule of its
own, so payloads cannot outlive their window because a second cron entry was
forgotten.

Redaction **allow-lists the envelope** rather than pruning known-bad fields:
when Pronatona adds a payload field later, it is redacted by default instead
of leaking until somebody notices.

## What is deliberately never erased

The audit trail. `AuditEvent` records that an erasure happened, who performed
it and the reason — never the erased values. Removing it would destroy the
only proof that the request was honoured.

## Known gaps

- **Cross-system erasure is manual** (see above).
- **No data-subject export** (Art. 15/20). If someone asks for a copy of their
  data, it has to be assembled by hand from the customer, opportunity, timeline
  and task records.
- **No automatic retention limit on projections themselves** — only on raw
  payloads. A customer record with no activity for years is kept indefinitely.
  A retention policy for dormant customers should be agreed before volume
  makes it a real exposure.
