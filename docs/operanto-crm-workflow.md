# Operanto CRM operational workflow (OI-4)

Status: delivered on `feature/oi-4-crm-workflow`, behind `OPERANTO_CRM_ENABLED`
(default off). Builds on the OI-3 foundation
(`docs/operanto-crm-foundation.md`). Rules come from the engine packages
extracted in OI-2 — this slice supplies the bindings, not new business logic.

## What ships

**Work queue** (`/crm/queue`, `src/lib/services/crm/queue.ts`). "What do I do
next", computed deterministically by `@operanto/crm-workqueue`: eight priority
categories (overdue callbacks → due callbacks → appointment prep → overdue
tasks → new leads → no-activity → due today → other active), with the
**resting rule** (a lead with a future callback disappears until it is due)
and stable tie-breaks. The service only fetches candidates inside the tenant +
assignment scope and supplies `now`; ordering never lives in the query.
Principal mapping: the engine compares opaque ids, so Operanto's
**membership** id is passed where the standalone CRM passed a user id.

**Work locks** (`src/lib/services/crm/locks.ts`). An exclusive work session so
two agents never call the same person. The single-active-lock guarantee is a
**partial unique index** (`leadId WHERE releasedAt IS NULL`) written by hand in
the migration — concurrent acquires are resolved by the database and the loser
reads the winner (name only). Expiry is swept on the next acquire, so it never
depends on user traffic. Managerial **override** is permission-gated
(`crm.locks.override`), audited, and notifies the displaced holder — an
override is never silent.

**Calling workflow** (`src/lib/services/crm/calls.ts`). Two steps:
`startCall` writes the `CallAttempt` **and its Activity before the dial** (an
abandoned call is still evidence, and supervisors see it via
`listAbandonedCalls`); `recordCallOutcome` enforces the **follow-up
invariant** from `@operanto/crm-calloutcome` — every outcome forces a valid
next action, negative outcomes require a reason, retries and callbacks require
a future time. One transaction walks the status path (inserting CONTACTED
where the machine requires it), upserts **THE** open callback task, cancels
open work on terminal outcomes, re-syncs the derived scheduling fields and
audits. A call remains **one** timeline entry: the pre-created Activity is
mutated, never duplicated. `recordOutcomeAndNext` releases the lock only after
a successful save and hands back the next queue lead.

**Notifications** (`src/lib/services/crm/notifications.ts`, `/notifications` +
topbar bell). The platform's first user-directed signal surface, contributed
by the CRM as the OI assessment planned. One write path that joins the
caller's transaction; payloads are **i18n keys, never stored prose**;
idempotency by constraint `(membership, type, entity, dedupeKey)`; reads are
strictly self-scoped. `notifyMany` (createMany + skipDuplicates) is the only
safe path for anything that can legitimately repeat inside a transaction.

**Privacy.** Erasure now also redacts call history (the dialled number IS the
personal datum; notes quote the person), releases open work sessions on the
erased lead, and deletes its notifications. The attempt row survives as
evidence that a call happened, without its content.

## Permissions (added to the one matrix)

`crm.calls.start`, `crm.calls.record_outcome` — operator work.
`crm.locks.override` — supervisor tier (ADMIN/SUPERVISOR only).

## Tests

10 integration tests (`test/crm-workflow.integration.test.ts`): queue ordering
and the resting rule; exclusion of do-not-contact, terminal and other people's
leads; one-active-holder + same-member refresh; expired-lock sweep; audited
override with notification to the displaced holder and self-scoped reads;
attempt-before-dial with one timeline entry; both follow-up refusals
(no-follow-up and missing time); terminal cleanup with the structural
do-not-call flag; abandoned-call exception view; erasure of call content.
Suite totals: 330 unit / 150 integration / build green.

Also fixed here: the integration suite's `TRUNCATE ... CASCADE` hook now
clears the CRM tables too, and Vitest's 10 s default hook timeout made it
flake under load — `vitest.integration.config.ts` sets explicit bounds
(60 s hooks, 30 s tests), verified over three consecutive full runs.

## Not in this slice

Appointments/scheduler UI, imports, contact requests, assignment pools, and
the time-based notification sweep (due/overdue reminders currently arrive from
actions, not from a scheduler — the sweep is a small follow-up that reuses
`notificationDedupeKeys`). Telephony remains URI-based (MicroSIP) until a
provider adapter implements the `@operanto/crm-voice` contracts against the
connection stored in Settings → Integrations → Telephony.
