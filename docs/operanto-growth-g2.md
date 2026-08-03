# Operanto Growth G2 — Target Profiles and Imported Accounts

Status: delivered on top of the G1 foundation (`16d7d9e`). G2 is a
controlled account-configuration and import capability with **no external
execution**: no research, no AI, no outreach, no sending, no URL fetching.
G3–G8 remain gated.

## Feature flag

`OPERANTO_GROWTH_ENABLED=1` — server-side only, default off, no
request-derived input can enable it. When off: the sidebar section is
absent and every `/growth` route 404s at the layout (the area does not
exist). Staging and production keep the flag off until explicitly enabled.
Covered by unit tests; the E2E server runs with the flag on (a
single-server E2E run cannot flip a boot-time variable — the disabled path
is unit-verified).

## Routes

`/growth` (operational counts only — profiles, active profiles, imported
accounts, duplicate candidates, imports awaiting commit, recent accounts;
no fabricated metrics) · `/growth/target-profiles` (+ `/new`, `/[id]`) ·
`/growth/accounts` (search, filters, pagination) · `/growth/accounts/[id]`
(detail, edit, assign, lifecycle, contacts, provenance, timeline, honest
placeholders: "Research not yet run") · `/growth/accounts/import` (staged
wizard). Navigation shows exactly Overview / Target Profiles / Accounts.

## Target Profiles

CRUD on the G1 model (name unique per organisation, size-range validation,
list-field trimming/caps). Statuses DRAFT/ACTIVE/PAUSED/ARCHIVED — archive
instead of delete; no destructive delete exists. Activation changes what
imports may attach to and nothing else. Audited:
`growth.profile_created/_updated/_status_changed` (changed field names
only).

## CSV import

Staged and stateless: **Upload → Parse → Preview → Map → Validate →
Duplicates → Confirm → Commit → Results.** The raw file never reaches the
server's storage — the text travels with each request, preview writes no
domain rows (only the `GrowthImport` operational record: filename,
checksum, delimiter, mapping, counts, content-free report), and commit
re-parses deterministically, refuses if the checksum changed, and runs in
one transaction. Re-committing a committed import refuses.

Parsing: UTF-8, comma/semicolon auto-detected, RFC-4180 quoting, BOM/CRLF
handled. Limits: 2 MB, 2000 rows, 60 columns, 2000-char cells; null bytes,
duplicate headers and unterminated quotes reject. Formula-injection
neutralization (`=`, `+`, `-`, `@` prefixes) applies to anything exported.
Mapping: header-based with German/English guesses, user-adjustable, ignored
columns supported. Validation: required name, integer employee estimate,
e-mail shape, ISO-2 country. Partial import happens only through the
explicit accept-partial confirmation.

## Normalization

Deterministic and unit-tested: domains (scheme/path/port/www stripped,
lower-cased), company names (legal forms GmbH/AG/KG/Sh.p.k./Ltd… removed,
punctuation collapsed) for comparison only — display names are never
overwritten; e-mails via the existing normalizer; countries upper-cased.

## Duplicate rules

Conservative and explainable. Exact: normalized domain (constraint-backed),
existing contact e-mail. Possible: normalized name + country, or + city.
In-file: repeated domain inside the upload. Nothing is ever merged
automatically; resolutions are per-row human decisions — **skip** (default),
**import as new** (blocked for exact domain duplicates, which the
constraint would refuse), **link to existing** (adds provenance and the
contact; changes nothing on the account — silent overwrite is
structurally impossible). Duplicate decisions are audited
(`growth.duplicate_detected`, counts on commit).

## Account lifecycle (G2 exposure)

G1's machine, pre-research segment only: `IMPORTED` (incomplete) /
`NEEDS_REVIEW` (complete imports) → `READY_FOR_RESEARCH` / `REJECTED`, and
`SUPPRESSED` from anywhere via the explicit suppress action. `APPROVED`
and later states exist in the schema but are unreachable in G2 — they
require research (G3+). All transitions server-validated by the machine,
audited, and mirrored as account-timeline Activity events.

## Suppression invariant (holds before any send path exists)

Suppressed accounts/contacts are visibly badged. Imports cannot
reactivate: an erased contact's e-mail (tombstone) is **not recreated** by
re-import (policy: erased people do not return via CSV); an ordinarily
suppressed e-mail imports the contact pre-marked suppressed; a suppressed
domain imports its account directly into `SUPPRESSED`. Editing an
account's domain onto a suppressed domain re-applies suppression rather
than bypassing it. Consent is never inferred — imported contacts are not
sendable by existence, and no sending exists in Release 1 at all.

## Permissions

G1's set enforced end-to-end: `growth:view` (pages),
`growth:manage_target_profiles`, `growth:import_accounts`,
`growth:edit_accounts`, `growth:review_accounts` (lifecycle),
`growth:assign_accounts`, `growth:manage_privacy` (erasure). Viewing,
profile management, import authority and lifecycle authority are separate;
operators keep read + research/drafting-prep rights only. No new roles.

## Privacy and retention

Imported contacts carry provenance (source, collectedAt, purpose,
verification status). `eraseGrowthContact` remains complete for imported
data (PII redacted in place, drafts addressed to the contact redacted, the
suppression objection survives). The G1 retention sweep covers imported
contacts. `GrowthImport` retains no row content, so raw-import retention
is structurally satisfied. Audit metadata: ids, counts, field names,
reason codes — never CSV rows, e-mails, phones or descriptions (tested).

**Unresolved legal-policy assumptions (documented, not decided here):**
the lawful basis for holding imported B2B contact data
(legitimate-interest assessment) and the DACH outreach posture remain the
product owner's decisions before any G6 sending; the prospect retention
default (365 days) awaits the same legal confirmation as message
retention.

## Development seed

`SEED_GROWTH_DEMO=1` (development only): the G1 fixtures plus one
suppressed fictional contact with its suppression entry. No real people,
companies, routable domains, or staging/production seeding.

## Tests

Unit 198 (CSV parse/limits/injection/mapping/validation, normalizers,
lifecycle, flag policy) · integration 123 on real PostgreSQL (profiles
CRUD + cross-tenant + permissions; preview-writes-nothing; explicit
partial; exact/possible/in-file duplicates with resolutions;
link-never-overwrites; tombstone-not-recreated; suppressed-domain import;
checksum mismatch; cross-tenant commit; audited field-name-only edits;
suppression-bypass-by-edit prevention; same-org assignment) · E2E: profile
flow, import flow with duplicate + invalid handling, suppression/erasure
privacy flow, tenant isolation.

## Known limitations

Revenue range, branch counts and social links are not in the G1 model and
therefore not importable (documented, deferred). Contact-level dedupe
links only via account context. The disabled-flag path is unit-tested,
not E2E-tested (single-server constraint). Import error reports render
in-page; file download arrives with real need.

## G3 handoff

G3 (unauthorized until instructed) builds on: `ResearchRun`/
`ResearchEvidence` models already present, the provider-adapter registry
idiom, accounts sitting in `READY_FOR_RESEARCH`, and the AI gateway with
mock-default fixtures. Evidence excerpts must be treated as untrusted
content per the ratified injection rules.
