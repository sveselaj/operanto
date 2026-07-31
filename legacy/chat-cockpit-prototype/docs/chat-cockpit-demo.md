# Chat cockpit — demo & local setup

## Prerequisites

- **Node ≥ 20.12** (Vitest 4 needs `node:util.styleText`; the runtime is fine on
  20.6 but the test runner is not). Use 20.19+ or 22.
- pnpm, Docker (for Postgres).
- **No API key needed** — the assistant runs in deterministic **mock mode** when
  `ANTHROPIC_API_KEY` is empty. Set it (and optionally `AI_MODEL_*`) in `.env`
  to use real models.

## Setup

```bash
pnpm install
cp .env.example .env          # DATABASE_URL, AUTH_SECRET; ANTHROPIC_API_KEY optional
pnpm db:up                    # Postgres via Docker (host port 5433)
pnpm db:push                  # apply schema (adds cockpit + CRM + real-estate tables)
pnpm db:seed                  # loads Bloom Studio, Lumea Goods, and Pronatona
pnpm dev                      # http://localhost:3000
```

### Demo accounts (password `operanto`)

| Email | Workspace | Vertical | Role |
|---|---|---|---|
| `ardit@pronatona.test` | Pronatona | real-estate | owner |
| `flaka@pronatona.test` | Pronatona | real-estate | manager |
| `endrit@pronatona.test` | Pronatona | real-estate | agent |
| `rea@pronatona.test` | Pronatona | real-estate | reviewer |
| `lana@bloomstudio.test` | Bloom Studio | generic | owner |
| `elira@lumeagoods.test` | Lumea Goods | generic | owner |

Sign in as **`ardit@pronatona.test`** for the full real-estate cockpit.

## Journeys

### 1 · Internal search (leads)
Assistant → *"Show buyers from Germany looking for apartments in Prishtina above €120,000"*
→ `search_contacts` runs → contact cards appear (Arben Krasniqi, Germany). Ask
*"Show his opportunities"* → `search_opportunities` → an opportunity card with the
extracted budget/area/timeline. Open Opportunities in the nav to see the pipeline.

### 2 · Property inquiry (grounded availability + send-with-approval)
Assistant → *"Is PR-1042 still available?"* → `check_property_availability` returns
**AVAILABLE** (authoritative) → the reply cites it and its last-updated time.
Then *"Draft a reply offering a viewing"* → `draft_customer_reply` (a **draft**,
not sent). Then *"Send it"* → `send_customer_message` is **write** → an
**approval card** appears; approve → the runtime sends via the channel adapter and
writes an audit entry. (Instagram send is a stub and will fail loudly; web-chat
conversations deliver in-app.)

### 3 · Sensitive action (publish)
Assistant → *"Draft an Instagram post for PR-1042"* → `draft_social_post` (draft).
Then *"Publish it tomorrow at 19:00"* → `queue_social_post` is **write** → nothing
publishes; an approval card appears. Approve → exactly one queue job is created via
the **mock** publisher (visible on the card and the audit log). The seed also ships
two pending approvals so `/pronatona/approvals` is populated on first login.

### 4 · Reserved property (no false positive)
Assistant → *"Is PR-1033 available?"* → availability returns **reserved** → the
assistant does **not** claim availability and offers matches
(`find_matching_properties`).

### 5 · Customer conversation in the cockpit (Slice 4)
Open the inbox, pick Arben's Instagram conversation, click **"Open in assistant
cockpit"**. A `customer_conversation` thread opens: the customer transcript is
pinned at the top, the right panel shows the contact, the opportunity (budget /
area / timeline), and the interested property. Now type *"summarize this
conversation"*, *"draft a reply offering a viewing"* (a **draft**), then *"send:
<your text>"* → an approval card. The assistant auto-targets this conversation —
you never pass an id. Replies **stream** in progressively and cards appear as each
tool completes.

## Verifying approval guarantees

`/pronatona/approvals` (as owner/manager): **Approve**, **Edit** (tweak a reply
body then approve), or **Reject**. Rejected actions never run; approving twice
executes once. Every decision appears in `/pronatona/audit`, correlated by turn.

## Adding a card renderer

Card blocks are `{ card: "<kind>", data }`. Map a new kind in
`src/components/cockpit/cards.tsx` → `renderCard(kind, data, slug)`; unknown kinds
fall back to a clean key/value card (never raw JSON). Keep components read-only and
serializable — `data` is the tool's validated `outputSchema` result.

## Checks

```bash
pnpm test        # 59 tests (tool runtime, approvals, idempotency, planner, policy)
pnpm lint        # 0 errors
npx tsc --noEmit # clean
```

## Known limitations

- Streaming is real (NDJSON route + `ReadableStream`), but the reply text is
  chunked server-side rather than token-streamed — the provider uses forced-tool
  structured output, so this stays provider-agnostic and works in mock mode.
- Social publishing and Instagram/WhatsApp send are mock/stub (no credentials).
- `get_agent_availability` derives slots (no live calendar).
- Translation in mock mode is a labelled pass-through (real model translates).
- One `customer_conversation` thread per conversation (find-or-create; no unique
  DB constraint, so a rare race could create two — low risk, user-initiated).
