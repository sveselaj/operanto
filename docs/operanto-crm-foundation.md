# Operanto CRM foundation (OI-3)

Status: delivered on `feature/oi-3-crm-foundation`, flag-gated
(`OPERANTO_CRM_ENABLED=1`, default off — staging and production remain off
until explicitly enabled). Program context: the OI program integrates the
CRIMSS sales CRM as an optional native Operanto module; the governing
assessment and the canonical business language live in the CRIMSS repo
(`docs/OPERANTO_CRM_INTEGRATION.md`, `docs/OPERANTO_CANONICAL_DOMAIN_MODEL.md`,
`docs/OPERANTO_SHARED_SERVICES.md`, `docs/OPERANTO_EVENT_MODEL.md`,
`docs/OPERANTO_PERMISSION_MODEL.md`).

## What this slice ships

1. **Engine packages** (`packages/crm-*`, 16): the pure CRM business engines
   extracted in OI-2, imported verbatim with their unit test suites
   (provenance + sync discipline: `packages/README.md`). Boundary rules are
   CI-enforced (`test/package-boundaries.test.ts`): no framework/app/Prisma/
   Node imports, allowlisted npm deps, acyclic engine graph, pinned API
   surfaces. Resolution via the `@operanto/*` tsconfig path.
2. **RBAC**: the `crm.*` permission family (canonical dot-namespaced, per the
   OI permission model) and the **AUDITOR** role — organisation-wide
   read-only compliance access (view permissions only; conversations
   deliberately excluded — message content is not audit material). AUDITOR
   requires 2FA like the other privileged roles. Tests:
   `test/crm-rbac.test.ts`.
3. **Schema** (two additive migrations): `Lead` (the general commercial
   pipeline work item reserved by product decision 10 — NOT the Pronatona
   `Opportunity` projection and NOT the person; `customerId` links to the
   Customer once resolved), `LeadStatusHistory` (append-only),
   `Activity.leadId` / `Task.leadId` anchors, `Task.type` (string-typed like
   `activityType`) and `TaskStatus.CANCELLED` (auto-cancelled work — nobody
   did it).
4. **Service** (`src/lib/services/crm/leads.ts`): list/get/create/transition/
   assign on the spine (`OrgContext`, `requirePermission`,
   `leadAccessWhere(ctx)` record scope, Activity + ids-only audit). The
   standalone CRM's invariants carried over intact:
   - status changes only through `transitionLead` — one transaction writing
     lead + history + activity (+ audit), transition legality from the
     `crm-leadstatus` machine, reason/schedule requirements enforced;
   - at most ONE open CALLBACK task per lead (upsert, never a second);
   - terminal statuses cancel open lead tasks (CANCELLED, not COMPLETED);
   - `callbackAt`/`nextActionAt` are DERIVED (`syncLeadActionFields` inside
     every mutating transaction);
   - `DO_NOT_CONTACT` sets the structural `doNotCall` flag.
5. **Privacy**: leads join `eraseCustomer` — linked leads' working-copy
   contact fields are redacted in place, their activities and task titles
   erased, and `doNotCall` is set; `ErasureResult.leads` reports the count.
   Unlinked leads (no `customerId`) are pre-identity working data; lead-level
   retention and the customer-link backfill arrive with the migration slice
   (OI-5).
6. **UI**: `/crm/leads` (list, status filters, supervisor-tier create) and
   `/crm/leads/[id]` (pipeline transition with machine-driven target list,
   assignment, timeline, status history) in the cockpit idiom. Sidebar "CRM"
   group appears only when the flag is on AND the role holds `crm.view`;
   the `/crm` layout 404s with the flag off (the Growth gate pattern).
7. **Seeds**: `SEED_CRM_DEMO=1` (development only) creates three fictional
   leads, one with an open callback.
8. **Tests**: 330 unit (packages + rbac + existing) · 131 integration
   (incl. `test/crm.integration.test.ts`: flag gate, tenant isolation,
   operator record scope, per-role permission denials, state machine with
   history/activity/audit, the one-open-callback invariant with derived
   fields, terminal cleanup, erasure reaching lead surfaces) · build green.

## Deliberate boundaries (not in this slice)

- **Work queue, work locks, calling workflow, imports, contact requests,
  assignment pools, notifications** — later slices; their engines are already
  in `packages/` and their invariants documented in the OI docs.
- **Telephony is not linked.** The organisation's cloud phone system
  currently runs beside the CRM with no integration. `packages/crm-voice`
  carries the contracts (`CallProvider`, `VoiceProvider`,
  `TranscriptProvider`, `RecordingProvider`) that the calling slice + OI-8
  will implement against the actual provider (click-to-call out, call-event
  webhooks in → call outcomes, voicemails/transcripts → activities). Until
  then, calls made in the phone system leave no trace on leads.
- Lead ↔ Customer linking UI, conversation/growth handoffs (OI-7/OI-9),
  localisation (English-only, like the rest of the cockpit).

## Development notes

- Local cockpit browsing: `.env`'s `NEXT_PUBLIC_*` point at staging hosts, so
  `localhost` is an unknown host to `proxy.ts` and cockpit paths redirect
  away. Run dev with the localhost overrides (as `pnpm test:e2e` does):
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000 NEXT_PUBLIC_APP_URL=http://localhost:3000
  NEXT_PUBLIC_API_URL=http://127.0.0.1:3000 AUTH_URL=http://localhost:3000 OPERANTO_CRM_ENABLED=1 pnpm dev`.
- `scripts/verify-crm-ui.ts` (dev-only) walks login → leads → detail with the
  seeded fixtures and saves screenshots.
- The `crm-permissions` package's internal role matrix maps the standalone
  CRM's roles and is NOT consulted here — `src/lib/rbac.ts` is the one
  permission engine in this deployment (see `packages/README.md`).
