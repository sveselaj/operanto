# Data ownership

**Pronatona is the system of record** for: properties and their status,
real-estate leads and their authoritative status, viewing requests, staff
membership and property/lead assignments inside Pronatona.

**Operanto owns**: operational projections (Customer, Opportunity,
PropertyContext), orchestration state (tasks, timeline, assignments *inside
Operanto*), integration state (InboundEvent, mappings), and its own identity
(users, memberships, invitations, audit).

Rules in this release:

- Operanto never writes to Pronatona. There is no two-way synchronization.
- Operanto stage changes do not alter Pronatona lead status; the authoritative
  source status is preserved separately (`Opportunity.sourceStage`) and
  re-applied whenever Pronatona emits `lead.status_changed`.
- Pronatona IDs never become Operanto primary keys; links go through
  `ExternalIdentityMapping` and `source*Id` columns.
- Deleting data in Pronatona does not delete Operanto projections (they are
  operational history). GDPR-style erasure requests must be executed in both
  systems explicitly.

## Future two-way integration (planned, not implemented)

Direction Operanto → Pronatona will be **command-based, not sync-based**:
Operanto issues explicit commands (e.g. `assignLead`, `updateLeadStatus`) to a
secured Pronatona command API (mutual authentication, idempotency keys, audit
on both sides), and Pronatona remains free to reject them. Pronatona then
emits the resulting events back, closing the loop through the same event
pipeline. No table-level replication in either direction. The
`CustomerOperationsClient` interface on the Pronatona side and the
`operanto*Id` anchor columns already reserve this seam.
