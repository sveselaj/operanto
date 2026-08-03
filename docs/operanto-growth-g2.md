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

Staged and stateless: **Upload → Parse → Preview (binds profile +
mapping) → Map → Validate → Duplicates → Confirm → Commit → Results.**
The raw file never reaches the server's storage. Preview requires an
**ACTIVE target profile of the current organisation** and binds it, with
the column mapping, to the `GrowthImport` record; commit executes the
STORED configuration only — client-echoed mappings are verified against
the stored canonical form and any mismatch refuses with zero writes;
the target profile is never read from the client at commit and must still
be ACTIVE. Commit is **atomically claimable** (`PREVIEWED → COMMITTING`
compare-and-set): exactly one concurrent commit succeeds, the loser gets
a controlled already-committed error with no duplicate audit or
provenance; a failed commit transaction marks the import FAILED
(audited, content-free) and requires a fresh preview. Imported accounts
receive the bound `targetProfileId`; linked duplicates never have theirs
changed.

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
automatically. **Resolutions are validated server-side**: every entry
must reference a detected duplicate row; `link:` targets must exactly
equal the detected candidate's account id (arbitrary same-organisation
targets refuse); exact-domain duplicates cannot be "imported as new";
malformed values refuse — all pre-claim, so validation failures leave the
import re-committable. Linking adds provenance and the contact only —
tests prove the target account's fields, `targetProfileId` and
`updatedAt` are untouched.

## Account lifecycle (G2 exposure — server-enforced release boundary)

Two layers of enforcement. The G1 machine validates structural legality;
a **release boundary** (`releasePermitsTransition`) additionally restricts
the ordinary transition service to exactly the authorized pre-research
set: `IMPORTED → NEEDS_REVIEW | READY_FOR_RESEARCH` and `NEEDS_REVIEW →
READY_FOR_RESEARCH | REJECTED`. Suppression is not an ordinary transition
— it goes only through the dedicated suppression service. A crafted
server request cannot reach `RESEARCHING`, `READY_FOR_ASSESSMENT`,
`APPROVED` or anything later (integration-tested, including a row seeded
mid-pipeline that the service still refuses to advance). All permitted
transitions are audited and mirrored as account-timeline Activities.

## Target-profile lifecycle (server-enforced)

`DRAFT → ACTIVE | ARCHIVED` · `ACTIVE → PAUSED | ARCHIVED` · `PAUSED →
ACTIVE | ARCHIVED` · **`ARCHIVED` is terminal** — no rule authorizes
reopening. The UI renders exactly the server machine's options.

## Suppression invariant (holds before any send path exists)

Suppressed accounts/contacts are visibly badged. **Contact and domain
suppression are evaluated independently**: a suppressed domain ALWAYS
imports its account directly into `SUPPRESSED` — even when the row's
contact e-mail is also suppressed or erased (combined case
integration-tested). Contact rules are separate: an erasure tombstone
means the person is never recreated (the account itself still imports —
the company is not the person); an ordinarily suppressed e-mail imports
the contact pre-marked. Editing an account's domain onto a suppressed
domain re-applies suppression rather than bypassing it. Consent is never
inferred; no sending exists in Release 1 at all.

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

Unit 201 (CSV parse/limits/injection/mapping/validation, normalizers,
full lifecycle machine + G2 release boundary + profile machine, flag
policy) · integration 125 on real PostgreSQL (amendment adds: release-boundary
violation attempts incl. mid-pipeline seeding; ACTIVE-profile binding
with cross-tenant refusal; mapping-mismatch commits writing zero rows;
server-side resolution validation incl. arbitrary link targets; combined
contact+domain suppression; tombstone-alone account import; concurrent
commit racing the atomic claim) (profiles
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
