# Legacy: chat-first cockpit prototype (superseded)

This folder archives the previous Operanto iteration (commits `55f451b` and
`a1a8735`): a chat-first operations cockpit with an omnichannel inbox, AI
assistant, typed tool runtime with approvals, SOPs/studio/intelligence modules,
and an internal real-estate vertical. Its original README is preserved next to
this file.

It was superseded on 2026-07-30 by the focused Pronatona-integration MVP (see
the repository root README): a multi-tenant operational cockpit that receives
**signed domain events** from Pronatona and maintains customer/opportunity
projections. The inbox, AI automation, and social features are intentionally
out of scope for the first release and will be re-introduced on top of the new
foundation when they are reached on the roadmap.

Nothing in this folder is compiled, linted, or tested (excluded via tsconfig,
eslint, and vitest configs). Patterns worth re-transplanting later:

- `lib/tools/runtime.ts` — idempotent invocation creation (P2002-race safe) and
  atomic single-execution claims via conditional `updateMany`. The same
  patterns now live in the event processing pipeline.
- `lib/tools/*` + `components/cockpit/*` — the typed tool + approval UI, for a
  future AI-assisted phase.
- `lib/verticals/*` — the vertical adapter seam.
