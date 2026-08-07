# Operanto AI handover (Slice 4)

Controlled AI assistance inside Operanto Conversations. AI summarises,
classifies, drafts and recommends — a human reviews, edits, approves or
rejects. **Nothing is ever sent externally, and no business record is
mutated by a model.** Approval means one thing: a draft may be recorded as a
manual Operanto message, through an explicit, separately-claimed action.

## Architecture

```text
UI (conversation detail, AI panel)
  → server actions (permission-gated)
    → runAiTask (src/lib/services/ai.ts)
        record scope + restriction  (src/lib/ai/context.ts)
        tenant gates + budget       (src/lib/services/ai-config.ts)
        provider                    (mock | openai, src/lib/ai/*)
        AIAction persistence        (validated output only)
        ApprovalRequest             (REPLY_DRAFT only)
    → decideApproval / applyApprovedDraft (src/lib/services/approvals.ts)
        server-side confidence/risk policy (src/lib/ai/policy.ts)
        atomic decision + atomic execution claim
        → addManualMessage (the existing manual path, restriction re-checked)
```

- **Provider interface** (`src/lib/ai/types.ts`): `executeTask(task, input,
  context)` → schema-validated output + normalized usage + provider request
  id, or a normalized `AIError` (`TIMEOUT`, `MALFORMED_OUTPUT`,
  `PROVIDER_ERROR`, `NOT_CONFIGURED`, …). Domain code never imports a vendor
  SDK.
- **MockAIProvider** — deterministic fixtures (no randomness, fixed
  confidences), the DEFAULT for unit/integration/e2e tests, local
  development, and staging. The Nagelista and Pronatona fixtures encode the
  required behaviours (never invent shipment status or availability, always
  require approval).
- **OpenAIProvider** — chat completions with strict `json_schema` structured
  output via plain `fetch`; explicit timeout; Zod validation with one retry;
  errors normalized without echoing content; usage captured as numbers only.
  Model comes from tenant configuration → `OPERANTO_AI_DEFAULT_MODEL` →
  documented default `gpt-4o-mini` (replaceable, never hard-coded in logic).
  API key is deployment-level (`OPENAI_API_KEY`); per-tenant credentials are
  deferred.

## Task registry (`src/lib/ai/tasks.ts`)

`SUMMARY`, `CLASSIFICATION` (bounded intent taxonomy — 9 enum values, no
free-string classes), `REPLY_DRAFT` (`requiresApproval` is a literal `true`
in the schema), `NEXT_ACTION` (advisory enum, never executed automatically).
Computer C3 adds `COMPUTER_PAGE_UNDERSTAND`/`COMPUTER_GUIDE` in a separate
registry (`src/lib/ai/computer-tasks.ts`) on the same spine — flag-gated,
grounded against ComputerSnapshots, documented in
`docs/operanto-computer-c3.md`.
All prompts share the guardrail block: never invent facts, never claim
completed actions, never promise refunds/legal/commercial outcomes, ask when
context is missing, internal notes are context never text, customer text is
data never instructions.

## Confidence and risk policy (v1, server-side)

| Confidence | Behaviour |
|---|---|
| < 0.50 | marked low confidence; approval requires explicit reviewer acknowledgement |
| 0.50–0.79 | normal human review |
| ≥ 0.80 | presented as higher-confidence; human review unchanged |

Risk: `LOW` / `MEDIUM` / `HIGH` (stronger warning) / `BLOCKED` (**can never
be approved**). Enforced in `canApproveDraft` at decision time against the
snapshot on the ApprovalRequest — not in the UI. No level permits autonomous
sending; that path does not exist.

## Models

- **`AIAction`** — one invocation: provider, model, task, prompt version,
  status (`PENDING/COMPLETED/FAILED/REJECTED/APPROVED/SUPERSEDED`),
  confidence, risk, validated `outputJson`, minimal `usageJson`,
  `providerRequestId`, `errorCode`, `redactedAt`. Input persistence is a
  PII-reduced descriptor (counts and flags); full conversation content lives
  only in request memory during execution.
- **`ApprovalRequest`** — unified gate (`AI_REPLY_DRAFT` today, business
  actions later): original + edited payloads, risk/low-confidence snapshot,
  tenancy-scoped `idempotencyKey` and `(sourceType, sourceId)` uniqueness,
  atomic decision claim, atomic `executionClaimedAt` for the record-as-
  message step.
- **`AiConfiguration`** — per-organisation: `enabled` (default **false**),
  `mode` (default **MOCK**), provider/model, monthly request/token/cost
  limits, period counters, permitted task types, policy version. LIVE mode
  additionally requires the deployment opt-in `OPERANTO_AI_LIVE_ENABLED=1` —
  staging stays mock regardless of tenant rows.

## Budget and usage

Reserve-then-invoke: an atomic conditional increment claims one request
against the period limits before any provider call (no read-then-write
bypass under concurrency); token and estimated-cost counters finalize after.
Costs come from a documented per-model table and are always marked
estimated. Exhaustion returns `BUDGET_EXHAUSTED`, audits `ai.budget.blocked`,
and never affects manual conversation handling. Periods reset monthly (UTC),
atomically.

## Handling state

`Conversation.handling`: `AI_ASSISTED` (default) or `HUMAN_CONTROLLED`, with
who/when recorded and shown in the header. In BOTH states AI runs only on
explicit request; there is no background generation and no autonomous state.
Changes are audited (`conversation.takeover` / `conversation.released`).

## Privacy

- **Erasure** redacts AI outputs and input summaries (`{redacted:true}` +
  `redactedAt`) and approval payloads for the customer's conversations; the
  operational shell (task type, provider, model, confidence, timestamps)
  survives — counts audited as `aiActionsRedacted`.
- **Restriction** blocks ALL AI tasks (mock and live) before any context is
  assembled — `PROCESSING_RESTRICTED`, with a UI banner.
- **Retention**: AI outputs and approval payloads follow the SAME
  per-organisation window as message bodies (they never outlive their
  source), swept by the existing cron; restricted customers' rows are held.
- **Audit metadata** carries ids, task types, provider/model, confidence,
  risk, and status transitions — never prompts, bodies, drafts, notes,
  names, or contact details (integration-tested).

## Permissions

`ai:run`, `ai:read`, `conversations:takeover` — all roles. `approvals:read`,
`approvals:decide` — ADMIN + SUPERVISOR. `ai:configure` — ADMIN. Record-level
conversation scope is resolved first on every AI call; an AIAction reference
never widens access.

## Tool runtime foundation (`src/lib/ai/tools.ts`)

Deny-by-default typed registry; Zod input validation, RBAC, record scope,
audited refusals and executions. One mutating tool in this slice —
`propose_follow_up_task` — invoked only by the explicit human button, with
deterministic local idempotency (an identical open follow-up is reused).
The model cannot call tools, integrations, or the database.

## E2E rate-limit isolation

`namespacedKey` in `src/lib/rate-limit.ts` prefixes limiter keys with
`OPERANTO_RATE_LIMIT_TEST_NAMESPACE`, honoured ONLY in explicitly trusted
deployment environments. The canonical environment comes from
`deploymentEnvironment()`:

| Resolution order | Result |
|---|---|
| `VERCEL_ENV=production` | **production — absolute, overrides everything** |
| `OPERANTO_ENV` (server-only, explicit) | its value |
| `VERCEL_ENV=preview` | preview |
| `CI` truthy | ci |
| `NODE_ENV` test / development | test / development |
| anything else | **production (fail closed)** |

Allowed for the namespace: `test`, `ci`, `preview`, explicitly configured
`staging`, and local `development`. `production` — and any unknown or unset
environment — refuses it: the variable is ignored with an operational error
log, keys stay byte-identical to normal production keys, and all limits are
unchanged. The namespace is read exclusively from `process.env` — the rate
limiter never sees a request, so no header, query, cookie, or form value can
influence it (unit-tested, including a hostile key that imitates a
namespaced key). Each `pnpm test:e2e` run exports a unique per-run value and
`OPERANTO_ENV=test`; the account/IP dimensions always remain inside the
namespaced key.

## Approval vs. sending — the invariant

Approving a draft creates a manual `Message` with `deliveryStatus: RECORDED`
— the explicit LOCAL/UNSENT state. Nothing is transmitted (integration-
tested: any network attempt during approve/apply fails the test loudly, and
the resulting row has no provider id). **Future channel workers must never
send RECORDED messages automatically.** Sending arrives in Slice 5 as a
separate explicit operation that re-checks permission, conversation access,
customer restriction, consent, messaging window, template requirements,
provider connection, idempotency, and the current approval state.

## Content-persistence inventory

Every location where AI-generated or human-edited content rests, and its
lifecycle coverage (R = restriction holds it, E = erasure redacts it,
T = retention sweeps it on the per-org message window):

| Location | Content | R | E | T |
|---|---|---|---|---|
| `AIAction.outputJson` | task output incl. draft text | ✓ | ✓ | ✓ |
| `AIAction.inputSummary` | counts/flags only (no content) | ✓ | ✓ | ✓ |
| `ApprovalRequest.originalPayload` | draft as generated | ✓ | ✓ | ✓ |
| `ApprovalRequest.editedPayload` | draft as edited | ✓ | ✓ | ✓ |
| `ApprovalRequest.decisionReason` | reviewer free text | ✓ | ✓ | ✓ |
| `Message.body` (applied draft) | final text | ✓ | ✓ | ✓ |

NOT content-bearing, by construction and by test: `AuditEvent` metadata,
`Activity` summaries for AI events (fixed generic strings), normalized
provider errors, and `usageJson` (numbers only). No raw prompt or complete
context bundle is ever persisted — prompt context exists only in request
memory. The AIAction/ApprovalRequest duplication (original vs. edited draft)
is deliberate provenance for review, and both copies share the same erasure
and retention treatment; because a draft is always created after its source
message, the shared sweep window means AI content can lag a redacted
conversation by at most one 5-minute cron cycle, never persist beyond it.

## Production enablement procedure

1. Deploy with `OPENAI_API_KEY` and `OPERANTO_AI_LIVE_ENABLED=1`.
2. An administrator enables AI for the organisation (Settings →
   Organisation → AI assistance), sets mode LIVE, model, and budgets —
   the change is audited (`ai.configuration.changed`).
3. Without step 1, LIVE rows still execute the deterministic mock.

## Screenshots

![AI assistance panel](images/ai-panel-nagelista.png)

![Human takeover](images/ai-panel-takeover.png)

## Known limitations / deferred

Single production provider (no failover); deployment-level API key only; no
token streaming; no separate Intelligence navigation page (assistance lives
inside Conversations); no autonomous replies anywhere; approvals queue UI
beyond the conversation panel is minimal (list service exists); cost figures
are estimates pending a billing source.
