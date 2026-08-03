# Operanto Growth Prospecting Program — G1 architecture (ADR)

Status: G1 delivered. Authorisation: the Aug 2 gate on Growth work was
amended solely for **G1 — Architecture and Domain Foundation**; G2–G8
remain unauthorised, and the WhatsApp pilot review gate stays in force for
everything beyond this foundation. **Release 1 contains no sending
capability of any kind** — the closest act in the whole domain is a human
recording that they sent an approved message themselves.

Program framing: a controlled **Account Intelligence and Assisted
Outreach** capability. Operanto does not send thousands of generic
messages; it helps a human team identify the right companies, understand
why they matter, prepare evidence-based outreach and continue every
resulting relationship inside one accountable system.

## 1. Repository assessment (what G1 builds on)

The platform already provides: per-request `OrgContext` with `scope(ctx)`
tenancy and record-level access; 3-role RBAC (`domain:action`); Auth.js +
mandatory 2FA for privileged roles; additive-only Prisma migrations with
replay verification; the store-then-process pipeline (atomic claim,
bounded retries, dead-letter, cron sweep); the AI gateway (provider-
neutral, deterministic mock default, `AIAction` records, budgets); the
approval pattern (atomic decision + execution claim); ids-only audit; the
privacy lifecycle (erasure in place, restriction, bounded retention);
encrypted credentials; and the channel-adapter registry idiom
(deny-by-default). G1 adds a Growth domain that *joins* those systems —
it duplicates none of them.

## 2. Account/customer identity decision

**Prospects are not Customers.** `GrowthAccount` (a company) and
`GrowthContact` (a person at it) are separate, org-scoped entities.
Rationale: prospects are pre-relationship records with different
lifecycle, retention and legal posture; mixing them into `Customer` would
pollute the operational customer base and its erasure semantics. On
conversion, the account records `customerId` — the relationship timeline,
evidence and notes stay attached to the account, and the operational
relationship continues on the Customer. `Opportunity` remains the
Pronatona projection (ratified product decision #10); any growth pipeline
entity is a separate model, deferred past the pilot.

## 3. Minimal domain model (12 entities, one migration)

`TargetProfile` · `GrowthAccount` · `GrowthContact` ·
`AccountSourceRecord` (provenance per import/discovery row) ·
`ResearchRun` · `ResearchEvidence` (claim + classification
VERIFIED_FACT/INFERENCE/HYPOTHESIS + source + confidence) ·
`AccountScore` (AI fields and human-override fields separate, one current
row per account, history in audit) · `AccountBrief` (versioned JSON
sections citing evidence ids) · `OutreachPlaybook` (approved/prohibited
claims; validator-enforced, not prompt-enforced) · `OutreachDraft` +
`OutreachDraftVersion` · `SuppressionEntry`. Plus
`Task.growthAccountId` (nullable) for review/follow-up tasks.

Deliberate G1 omissions (documented, not forgotten): no delivery/reply
entities, no provider-connection credentials, no compliance-policy model
(arrives with G6 where it gates sending), no growth opportunity model
(post-pilot). Membership references on growth rows are plain ids in G1;
they are promoted to relations when G2/G4 UI needs includes.

## 4. Lifecycle

`IMPORTED → NEEDS_REVIEW/READY_FOR_RESEARCH → RESEARCHING →
READY_FOR_ASSESSMENT → APPROVED → DRAFT_PREPARED → CONTACTED → REPLIED →
QUALIFIED → MEETING_BOOKED → CUSTOMER`, with re-research and NOT_NOW
loops, REJECTED re-openable, and **SUPPRESSED reachable from every
non-terminal state and terminal inside the machine** (leaving it is an
explicit privacy-gated operation, never an ordinary transition). Every
change goes through `assertTransition` and is audited; there is no
free-form status write. Draft machine: `DRAFT → AWAITING_REVIEW →
APPROVED → MANUALLY_SENT`, REJECTED back to DRAFT, CANCELLED — no
sending states exist.

## 5. Permissions (17, three roles, no new roles)

ADMIN: all. SUPERVISOR: everything except `growth:manage_privacy` and
`growth:manage_providers`. OPERATOR: `view`, `run_research`,
`review_evidence`, `generate_drafts`, `edit_drafts` — deliberately **not**
`approve_drafts`, `record_manual_send`, `import_accounts` or
`override_scores`. Drafting authority and approval authority are
different permissions; recording a manual send is a third.

## 6. Privacy and retention

Prospect personal data is GDPR personal data from the first row.
`GrowthContact` records provenance (`source`, `collectedAt`, `purpose`,
`verificationStatus`). `eraseGrowthContact` redacts PII in place, redacts
any drafts addressed to the contact, and writes a minimal
`SuppressionEntry` first — the objection outlives the data.
`redactExpiredGrowthContacts` (cron, `OPERANTO_PROSPECT_RETENTION_DAYS`,
default 365) redacts contacts of accounts that ended REJECTED/SUPPRESSED/
NOT_NOW. Seed data is entirely fictional (`.example` domains, invented
names). Raw provider payloads carry `payloadRedactedAt` for future sweeps.

## 7. Audit design

Reuses `AuditEvent` via `audit()` — no parallel growth audit table.
Event types: `growth.account_created`, `growth.duplicate_detected`,
`growth.account_status_changed`, `growth.account_suppressed`,
`growth.contact_erased`, and (G2+) profile/import/research/score/brief/
draft events following the same naming. Metadata is ids-only — company
names, personal names and draft content never enter the audit trail.

## 8. Provider-adapter boundaries (contracts now, implementations later)

`AccountDiscoveryProvider` and `AccountResearchProvider` follow the
channel-adapter idiom: deny-by-default registry, mock first, org-scoped
encrypted credentials when a real provider lands (G3), provenance on
every record. Manual creation and CSV import are "providers" too, so all
intake shares one path through `AccountSourceRecord`. No delivery
provider exists in Release 1 by design.

## 9. Routes and navigation

None in G1. G2 adds `(app)/growth/*` pages; the sidebar entry will be
gated by `growth:view` **and** a deployment flag so only the internal
dogfood organisation sees it (honouring "no navigation until the
capability is real"). Suggested structure: Overview · Target Profiles ·
Accounts · Review Queue · Drafts · Settings.

## 10. Migration plan

One additive migration `20260803115902_growth_foundation`: 12 new
tables, 6 new enums, one nullable column on `Task`. Zero destructive
statements. Verified: clean replay on a fresh database and upgrade
deploy on an existing one.

## 11. Testing strategy

Unit: lifecycle machine (happy path, skips, terminals,
suppression-reachability, draft machine), normalizers (domain, legal
forms, URLs). Integration (real PostgreSQL): creation + provenance +
ids-only audit, constraint-backed dedupe incl. cross-tenant
non-collision, tenant isolation, per-role permission denials, audited
machine-enforced transitions, suppression (domain + contact entries,
tenant-scoped, terminal), erasure (PII redaction, draft redaction,
surviving objection), retention sweep selectivity. E2E arrives with UI
in G2+.

## 12. Assumptions and risks

- Internal use runs as a dedicated Operanto organisation (dogfooding on
  standard multi-tenant discipline); no platform-level backdoors.
- DACH outreach law (UWG §7 et al.): the pilot uses manual, individual
  sends; automated email for DE/AT/CH would require explicit legal
  sign-off at G6 — config must err toward blocking. Operanto assists
  with workflow controls but does not determine legal compliance.
- Evidence excerpts collected in G3 are untrusted content under the
  ratified injection rules; the drafting validator (G5) enforces
  citation of known evidence ids and refuses prohibited claims.
- Score displays must carry confidence and missing-data warnings; the
  score is a prioritisation aid, never objective truth.
- `list_overdue`-style breadth queries and all future agent tools build
  over these services (tools-over-services invariant).
