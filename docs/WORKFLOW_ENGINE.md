# Operanto — Operational / Workflow layer (design proposal)

> Status: **design doc, not yet built.** Proposes the commercial + process spine
> that sits above the MediaSync communication layer (see [MEDIASYNC.md](./MEDIASYNC.md)).
> Engine philosophy: **generic and config-driven** — verticals (Windows, Solar,
> HVAC, …) are *data*, not forked code.

## 1. Where this sits

```
Customer channels  ──►  MediaSync (comms layer: inbox, identity, consent, delivery)
                              │
                              ▼
                    ┌───────────────────────────────────────────────┐
                    │ Operational layer (THIS DOC)                   │
                    │  Lead Engine   · Opportunity + Requirements    │
                    │  Workflow      · Definition/Step/Instance      │
                    │  Catalogue     · Product + BusinessRule        │
                    │  Quoting       · Quote + QuoteLine             │
                    │  Approvals     · ApprovalRequest (generic gate)│
                    │  Scheduling    · Appointment                   │
                    │  Integration   · IntegrationAction (CRM/ERP)   │
                    │  Document AI    · Document + Extraction         │
                    └───────────────────────────────────────────────┘
                              │
                              ▼
                  CRM · ERP · Calendar · Payments
```

**The spine is `Opportunity`.** A `Conversation` stays the communication record;
an `Opportunity` is the commercial object. One customer has many opportunities;
one opportunity gathers many conversations, requirements, a workflow instance,
quotes, appointments, approvals and documents.

## 2. Design principles

1. **Opportunity is the join point.** Conversation → (AI detects) → Opportunity → everything else.
2. **Verticals are configuration.** `WorkflowDefinition`, `Product`, `BusinessRule` are per-workspace rows. The same engine runs Operanto Windows and Operanto Solar — no code fork. This is the strategic reason to pay the modeling cost now.
3. **Reuse what exists** (no new infra where a pattern already works):
   - **AI** → log every extraction/quote-draft through the existing `AIAction`.
   - **Audit** → status/stage transitions write `AuditLog` rows (plus a queryable `WorkflowTransition`).
   - **Idempotent external calls** → `IntegrationAction` mirrors the MediaSync `SyncJob`/`WebhookEvent` shape (idempotencyKey, attempts, outcome).
   - **Rule shape** → `BusinessRule` reuses the `Automation` conditions/actions-JSON-validated-by-Zod pattern.
4. **Tenant-safe by construction.** Every table carries `workspaceId`, indexed, `onDelete: Cascade` from `Workspace` — same as the rest of the schema.
5. **Money is `Decimal(12,2)`** with an explicit `currency`; never floats.

## 3. Proposed enums

```prisma
enum OpportunityStatus { open won lost abandoned }
enum RequirementStatus { provided missing rejected }
enum WorkflowStatus     { active blocked completed cancelled }
enum QuoteStatus        { draft reviewed approved sent accepted declined expired }
enum ApprovalStatus     { pending approved rejected cancelled }
enum AppointmentType    { survey consultation installation support delivery }
enum AppointmentStatus  { proposed scheduled confirmed completed cancelled no_show }
enum IntegrationStatus  { pending running success failed retrying }
enum ProductType        { product service }
enum DocumentKind       { photo pdf plan form other }
enum DocumentStatus     { uploaded processing extracted failed }
enum TaxMode            { exclusive inclusive } // prices entered net or gross
```

## 4. Proposed models

### 4.1 Lead Engine — Opportunity + CustomerRequirement

```prisma
model Opportunity {
  id                    String            @id @default(cuid())
  workspaceId           String
  customerId            String
  title                 String?
  status                OpportunityStatus @default(open)
  stage                 String?           // denormalized current workflow step key (fast filtering)
  value                 Decimal?          @db.Decimal(12, 2)
  currency              String            @default("EUR")
  source                String?           // channel / campaign
  primaryConversationId String?
  assignedToUserId      String?
  closedReason          String?
  wonAt                 DateTime?
  lostAt                DateTime?
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt

  workspace        Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  customer         Customer              @relation(fields: [customerId], references: [id], onDelete: Cascade)
  assignedTo       User?                 @relation(fields: [assignedToUserId], references: [id], onDelete: SetNull)
  conversations    Conversation[]        // Conversation gains opportunityId
  requirements     CustomerRequirement[]
  workflow         WorkflowInstance?
  quotes           Quote[]
  appointments     Appointment[]
  documents        Document[]

  @@index([workspaceId])
  @@index([workspaceId, status])
  @@index([customerId])
}

// Structured facts collected from the conversation; the output of the Lead Engine
// and the input to "what's missing?".
model CustomerRequirement {
  id              String            @id @default(cuid())
  workspaceId     String
  opportunityId   String
  key             String            // e.g. "window_count", "material", "address"
  label           String
  valueType       String            // number | text | enum | date | bool
  value           String?           // stringified; typed by valueType
  status          RequirementStatus @default(missing)
  required        Boolean           @default(true)
  confidence      Float?
  sourceMessageId String?           // provenance: which inbound message yielded it
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  workspace   Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  opportunity Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)

  @@unique([opportunityId, key])
  @@index([workspaceId])
}
```

### 4.2 Workflow engine — Definition / Step / Instance / Transition

```prisma
model WorkflowDefinition {
  id          String   @id @default(cuid())
  workspaceId String
  key         String   // "windows_quote"
  name        String
  vertical    String?  // "windows"
  version     Int      @default(1)
  active      Boolean  @default(true)
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  steps     WorkflowStep[]
  instances WorkflowInstance[]

  @@unique([workspaceId, key, version])
  @@index([workspaceId])
}

model WorkflowStep {
  id                   String   @id @default(cuid())
  workflowDefinitionId String
  key                  String   // "collect_requirements"
  name                 String
  order                Int
  requiredRequirementKeys String[] // must be `provided` to leave this step
  allowedActions       Json     // [{type:"request_info"},{type:"generate_quote"},{type:"book_appointment"}]
  autoAdvance          Boolean  @default(false)

  definition WorkflowDefinition @relation(fields: [workflowDefinitionId], references: [id], onDelete: Cascade)

  @@unique([workflowDefinitionId, key])
}

model WorkflowInstance {
  id                   String         @id @default(cuid())
  workspaceId          String
  opportunityId        String         @unique
  workflowDefinitionId String
  currentStepKey       String?
  status               WorkflowStatus @default(active)
  context              Json?          // denormalized scratch state
  startedAt            DateTime       @default(now())
  completedAt          DateTime?

  workspace   Workspace            @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  opportunity Opportunity          @relation(fields: [opportunityId], references: [id], onDelete: Cascade)
  definition  WorkflowDefinition   @relation(fields: [workflowDefinitionId], references: [id], onDelete: Restrict)
  transitions WorkflowTransition[]

  @@index([workspaceId, status])
}

model WorkflowTransition {
  id                 String   @id @default(cuid())
  workflowInstanceId String
  fromStepKey        String?
  toStepKey          String?
  actorUserId        String?  // null = system/AI
  reason             String?
  createdAt          DateTime @default(now())

  instance WorkflowInstance @relation(fields: [workflowInstanceId], references: [id], onDelete: Cascade)

  @@index([workflowInstanceId])
}
```

### 4.3 Catalogue — Product + BusinessRule

```prisma
model Product {
  id          String      @id @default(cuid())
  workspaceId String
  sku         String?
  name        String
  type        ProductType @default(product)
  description String?
  unitPrice   Decimal?    @db.Decimal(12, 2)
  currency    String      @default("EUR")
  taxRate     Float       @default(0) // %
  unit        String?     // "each", "m²", "hour"
  active      Boolean     @default(true)
  config      Json?       // vertical options + per-product pricing rules
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  workspace  Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  quoteLines QuoteLine[]

  @@unique([workspaceId, sku])
  @@index([workspaceId])
}

// Same conditions/effect-JSON-validated-by-Zod shape as Automation.
model BusinessRule {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  type        String   // service_area | min_order | eligibility | pricing_modifier
  enabled     Boolean  @default(true)
  priority    Int      @default(0)
  definition  Json     // { conditions: [...], effect: {...} }
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, type, enabled])
}
```

### 4.4 Quoting — Quote + QuoteLine

```prisma
model Quote {
  id               String      @id @default(cuid())
  workspaceId      String
  opportunityId    String
  number           String?     // human-facing quote number
  status           QuoteStatus @default(draft)
  currency         String      @default("EUR") // inherits Workspace.defaultCurrency
  taxMode          TaxMode     @default(exclusive)
  subtotal         Decimal     @default(0) @db.Decimal(12, 2)
  discountTotal    Decimal     @default(0) @db.Decimal(12, 2)
  taxTotal         Decimal     @default(0) @db.Decimal(12, 2)
  total            Decimal     @default(0) @db.Decimal(12, 2)
  validUntil       DateTime?
  notes            String?
  version          Int         @default(1)
  createdByUserId  String?
  approvedByUserId String?
  sentAt           DateTime?
  acceptedAt       DateTime?
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  workspace   Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  opportunity Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)
  lines       QuoteLine[]

  @@index([workspaceId])
  @@index([workspaceId, opportunityId])
}

model QuoteLine {
  id          String  @id @default(cuid())
  quoteId     String
  productId   String?
  description String
  quantity    Decimal @default(1) @db.Decimal(12, 2)
  unitPrice   Decimal @default(0) @db.Decimal(12, 2)
  discount    Decimal @default(0) @db.Decimal(12, 2) // absolute, on the line
  taxRate     Float   @default(0)                     // %
  lineTotal   Decimal @default(0) @db.Decimal(12, 2)
  position    Int     @default(0)

  quote   Quote    @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  product Product? @relation(fields: [productId], references: [id], onDelete: SetNull)

  @@index([quoteId])
}
```

### 4.5 Approvals — generic gate

```prisma
model ApprovalRequest {
  id             String         @id @default(cuid())
  workspaceId    String
  entityType     String         // "Quote" | "Opportunity" | "IntegrationAction" ...
  entityId       String
  action         String         // "quote.send" | "price.override" | "crm.push"
  status         ApprovalStatus @default(pending)
  requestedByUserId String?
  approverUserId    String?     // optionally pre-assigned
  decidedByUserId   String?
  reason         String?
  decisionNote   String?
  payload        Json?          // proposed change being gated
  createdAt      DateTime       @default(now())
  decidedAt      DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
  @@index([workspaceId, entityType, entityId])
}
```

### 4.6 Scheduling — Appointment

```prisma
model Appointment {
  id               String            @id @default(cuid())
  workspaceId      String
  opportunityId    String?
  customerId       String?
  conversationId   String?
  type             AppointmentType
  status           AppointmentStatus @default(proposed)
  title            String?
  scheduledAt      DateTime?
  durationMinutes  Int?
  location         String?
  assignedToUserId String?
  externalEventId  String?           // calendar-integration id
  notes            String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  opportunity Opportunity? @relation(fields: [opportunityId], references: [id], onDelete: SetNull)
  customer    Customer?    @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@index([workspaceId])
  @@index([workspaceId, scheduledAt])
}
```

### 4.7 Integration Hub — IntegrationAction

```prisma
// Mirrors the MediaSync SyncJob/WebhookEvent pattern: idempotent, retried, audited.
model IntegrationAction {
  id             String            @id @default(cuid())
  workspaceId    String
  provider       String            // "hubspot" | "salesforce" | "google_calendar" ...
  operation      String            // "upsert_contact" | "create_deal" | "create_event"
  entityType     String?
  entityId       String?
  idempotencyKey String?
  status         IntegrationStatus @default(pending)
  attempts       Int               @default(0)
  maxAttempts    Int               @default(3)
  request        Json?
  response       Json?
  error          String?
  scheduledAt    DateTime?
  completedAt    DateTime?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([provider, idempotencyKey])
  @@index([workspaceId, status])
}
```

### 4.8 Document AI — Document + Extraction

```prisma
model Document {
  id              String         @id @default(cuid())
  workspaceId     String
  customerId      String?
  opportunityId   String?
  conversationId  String?
  messageId       String?        // came in as an attachment
  kind            DocumentKind   @default(other)
  fileName        String
  mimeType        String
  sizeBytes       Int?
  storageKey      String         // object-store key (S3/R2/local)
  status          DocumentStatus @default(uploaded)
  createdByUserId String?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  workspace   Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  opportunity Opportunity?        @relation(fields: [opportunityId], references: [id], onDelete: SetNull)
  extraction  DocumentExtraction?

  @@index([workspaceId])
  @@index([workspaceId, opportunityId])
}

model DocumentExtraction {
  id          String   @id @default(cuid())
  documentId  String   @unique
  aiActionId  String?  // links to the AIAction that produced it
  schemaKey   String?  // which extraction schema was applied
  data        Json     // structured fields (e.g. dimensions, counts)
  confidence  Float?
  createdAt   DateTime @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

## 5. Touchpoints on the existing schema

- **Conversation** → add `opportunityId String?` (+ relation + `@@index([workspaceId, opportunityId])`). Many conversations → one opportunity.
- **Customer** → back-relations: `opportunities`, `appointments`, `documents`.
- **Task** → add optional `linkedOpportunityId` (follow-ups already link conversations/SOPs).
- **Workspace** → back-relations for every new model; add `defaultCurrency String @default("EUR")` and `defaultTaxRate Float @default(0)` (quotes/products inherit these).
- **AIAction** → no change; new AI tasks log here.
- **AuditLog** → no change; stage/status/approval transitions write rows.
- **MediaSync** → inbound attachments become `Document` rows; `Conversation.intent`/`leadScore` feed opportunity creation.

## 6. New AI tasks (provider-agnostic, structured output)

| Task | Input → Output |
|---|---|
| `extractRequirements` | conversation thread → `CustomerRequirement[]` (key, value, confidence) |
| `detectMissingInfo` | opportunity + workflow step → which required keys are missing + a drafted ask |
| `draftQuote` | requirements + catalogue + business rules → `QuoteLine[]` |
| `extractDocument` | document → structured fields (dimensions, counts, etc.) |

Existing `classifyIntent` / `scoreLead` become the trigger to **create an Opportunity** from a conversation.

## 7. RBAC additions

`opportunities:manage`, `quotes:manage`, `quotes:approve`, `appointments:manage`,
`catalog:manage`, `integrations:manage`, `approvals:decide`. Wire into the existing
`MATRIX` (owner/admin everywhere; manager most; agent on opportunities/quotes-draft/appointments; reviewer read).

## 8. Phased build order

Each phase ships end-to-end (schema → service → minimal UI) and is independently verifiable (tests + build), with a checkpoint between phases.

| Phase | Deliverable | Depends on |
|---|---|---|
| **A — Lead Engine** | Opportunity + CustomerRequirement; `Conversation.opportunityId`; `extractRequirements` + `detectMissingInfo`; "promote conversation → opportunity" + opportunities list + requirement checklist UI | — |
| **B — Catalogue** | Product + BusinessRule; admin UI | — (parallel with A) |
| **C — Quoting** | Quote + QuoteLine; `draftQuote`; quote builder with totals/tax/discount | A, B |
| **D — Approvals** | ApprovalRequest generic gate; gate `quote.send` + price overrides | C |
| **E — Workflow** | WorkflowDefinition/Step/Instance/Transition; seed a `windows_quote` definition; drive steps from requirements; "next permitted actions" surface | A |
| **F — Scheduling** | Appointment + calendar integration target | A |
| **G — Integration Hub** | IntegrationAction + first CRM connector (idempotent, retried — reuses the MediaSync connector pattern) | A |
| **H — Document AI** | Document + DocumentExtraction; photo/PDF extraction | A |

Recommended first slice: **Phase A** (the spine), which immediately makes the
window-company example real end-to-end.

## 9. Worked example — window company

1. WhatsApp DM arrives (MediaSync) → AI `classifyIntent = product_inquiry`, `scoreLead = 80` → **Opportunity** created, linked to the conversation.
2. `extractRequirements` → `CustomerRequirement` rows: `window_count=6 (0.9)`, `material=PVC`, `location=…`; `dimensions` and `timeframe` left `missing`.
3. `WorkflowInstance` on step `collect_requirements`; `detectMissingInfo` drafts "Could you confirm the rough dimensions and your preferred timeframe?" (agent approves the send via MediaSync).
4. Customer sends photos → **Document** rows; `extractDocument` fills `dimensions`.
5. All required keys `provided` → workflow advances to `generate_quote`; `draftQuote` builds **QuoteLine**s from the **Product** catalogue, applying **BusinessRule** pricing for the service area.
6. Quote needs sign-off → **ApprovalRequest** (`quote.send`) → manager approves → quote `sent`.
7. **Appointment** (`survey`) booked; **IntegrationAction** upserts the contact + deal into the CRM (idempotent, retried).
8. The whole thread, requirements, quote and appointment stay attached to the Opportunity.

## 10. Decisions (resolved)

1. **Money** → `Decimal(12,2)` (Postgres `numeric`, no float drift) with an explicit `currency` per quote/product, inheriting a new `Workspace.defaultCurrency` (`"EUR"`). One currency per quote — no mixed-currency lines.
2. **Tax** → per-line `taxRate` (%) supports mixed rates within a quote; add `Quote.taxMode` (`exclusive`/`inclusive`) for net vs gross pricing, and `Workspace.defaultTaxRate` to seed new products/lines. **No automatic jurisdiction/VAT-rules engine** in MVP — the rate is set per product/line. `taxTotal` is computed by grouping lines by rate.
3. **File storage** → a thin `BlobStore` adapter (`put`/`get`/`signedUrl`/`delete`) so `Document.storageKey` stays provider-agnostic. **Local disk in dev** (gitignored `.storage/`), **Cloudflare R2** recommended for prod (S3-compatible, zero egress) via the same S3 client. Only needed at **Phase H** — adapter lands then.
4. **First CRM** → **HubSpot** (best free tier + simplest REST API for SMBs): `upsert_contact` + `create_deal`. Ship a **generic outbound-webhook** connector alongside it as the zero-setup fallback for any ERP. (Phase G.)
5. **First calendar** → **Google Calendar** (OAuth) for two-way sync, plus an **ICS** attachment on every appointment as the zero-integration fallback. (Phase F.)
6. **Workflow authoring** → **JSON-seeded `WorkflowDefinition`s** validated by a Zod schema (same approach as `Automation`), with a light admin JSON editor (validated textarea). A visual builder is deferred. Phase E seeds a `windows_quote` definition.

### Schema deltas from these decisions
- `Workspace`: add `defaultCurrency String @default("EUR")`, `defaultTaxRate Float @default(0)`.
- `Quote`: add `taxMode TaxMode @default(exclusive)` (+ `TaxMode` enum).
- Storage/CRM/calendar are connector-level concerns (Phases F–H), not Phase A — so **Phase A is unblocked** and can start now.
