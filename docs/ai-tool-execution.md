# AI tool execution

Tools are the only bridge between natural language and backend effects. The AI
proposes a call by name + arguments; the **runtime** validates, authorizes,
gates on approval, executes, persists, and audits. The model has no direct DB
or code access.

## Tool contract (`src/lib/tools/types.ts`)

```ts
type ToolDefinition<TInput, TOutput> = {
  name: string;              // stable, e.g. "search_contacts"
  title: string;             // human label for cards
  description: string;       // advertised to the planner
  category: string;          // grouping (contacts, properties, …)
  risk: "read" | "draft" | "write";
  permission: Permission;    // RBAC permission required (deny by default)
  approval: "none" | "policy" | "always";
  idempotent?: boolean;
  inputSchema: z.ZodType<TInput>;   // validated before execute
  outputSchema: z.ZodType<TOutput>; // validated after execute
  card: string;              // UI renderer key, e.g. "property.availability"
  execute(exec, input): Promise<TOutput>;
  summarize(output, input): string; // one-line result for the card
};
```

## Runtime flow (`src/lib/tools/runtime.ts`)

`runTool(exec, tool, rawInput)`:

1. **Validate** `rawInput` against `inputSchema`. Invalid → `ToolInvocation`
   `failed` (code `invalid_input`), nothing runs.
2. **Authorize** with `can(role, tool.permission)`. Missing → `failed`
   (`forbidden`). Deny-by-default; enforced here even though the planner only
   sees permitted tools.
3. **Approval** via `requiresApproval(ctx, tool)`:
   - `none` → execute now.
   - `always` → create `ToolInvocation(awaiting_approval)` + `ApprovalRequest(pending)`; **do not execute**.
   - `policy` → require approval unless the workspace opted in (see [approval-workflows.md](./approval-workflows.md)).
4. **Execute** (when allowed): mark `running` → `tool.execute` → validate output
   → `completed` with `output` + `resultSummary`. Failure → `failed` with the
   message; no partial success is ever reported as success.
5. Every step writes an `AuditLog` (`assistant.tool.proposed|executed|failed`)
   with the turn's `correlationId`.

### Idempotency

- **Proposal:** `@@unique([workspaceId, idempotencyKey])` on `ToolInvocation`.
  The assistant keys each proposed call `"<correlationId>:<index>"`, so re-running
  a turn reuses the same rows instead of duplicating.
- **Execution:** the `awaiting_approval → running` transition is an atomic
  conditional `updateMany`. A duplicate approval finds the row already claimed
  (or `completed`) and returns the prior result — **exactly one execution**.

## Tool catalogue

Core (vertical-agnostic), `src/lib/tools/core/`:

| Tool | risk | permission | approval |
|---|---|---|---|
| `search_contacts`, `get_contact`, `get_customer_history` | read | conversations:read | none |
| `search_conversations`, `summarize_conversation` | read | conversations:read | none |
| `search_opportunities` | read | opportunities:read | none |
| `create_opportunity`, `update_lead_requirements` | write | opportunities:manage | none |
| `update_opportunity_stage`, `assign_opportunity` | write | opportunities:manage | **always** |
| `create_task`, `create_follow_up` | write | tasks:manage | none |
| `draft_customer_reply` | draft | conversations:reply | none |
| `translate_message` | read | conversations:read | none |
| `send_customer_message` | write | conversations:reply | **always** |

Real-estate vertical, `src/verticals/real-estate/tools.ts`:

| Tool | risk | permission | approval |
|---|---|---|---|
| `search_properties`, `get_property`, `check_property_availability`, `find_matching_properties` | read | properties:read | none |
| `get_agent_availability` | read | conversations:read | none |
| `draft_social_post` | draft | content:manage | none |
| `request_viewing` | draft | conversations:reply | none |
| `queue_social_post` | write | social:publish | **always** |
| `schedule_viewing` | write | properties:manage | **always** |

## Adding a tool

1. Create the `ToolDefinition` in `src/lib/tools/core/<area>.ts` (or a vertical's
   `tools.ts`) with Zod `inputSchema`/`outputSchema`, `permission`, `approval`,
   and a `card` key.
2. Register it in `src/lib/tools/core/index.ts` (or the vertical adapter).
3. If it needs a new RBAC permission, add it to `Permission` + the matrix in
   `src/lib/rbac.ts`.
4. Add a card renderer for its `card` key in `src/components/cockpit/cards.tsx`
   (see [chat-cockpit-demo.md](./chat-cockpit-demo.md) → "Adding a card").
5. The offline planner (`src/lib/ai/assistant-tasks.ts` → `mockPlan`) is
   keyword-driven; extend it if you want the tool reachable without a live model.

## Safety

- Customer text, imported content, and property descriptions are **untrusted
  data**, never instructions (stated in every system prompt).
- No secrets, tokens, stack traces, or raw model reasoning are ever persisted or
  rendered; only concise result summaries + validated outputs.
- `outputSchema` validation means a misbehaving tool can't inject arbitrary
  shapes into the UI.
