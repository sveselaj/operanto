# Product architecture: one external brand

Operanto is the **only** externally presented product. Everything the customer
sees — navigation, page titles, metadata, SEO content, onboarding, pricing,
API-facing labels, demo data — speaks of one product with capabilities, never
of separate sub-products.

> One product, one customer experience, and one commercial story — Operanto —
> supported internally by specialised engines, services, and architectural
> components.

## Positioning

Where a general platform description is needed, use:

> Operanto is an AI-powered customer operations platform that unifies
> communication, organisational memory, workflows, growth, and human-AI
> collaboration. It helps businesses understand customers, coordinate work,
> create campaigns, manage conversations, and turn every interaction into the
> appropriate business action.

Short form, where space is limited:

> Operanto unifies customer conversations, business memory, workflows, growth,
> and AI-human collaboration.

Do **not** describe Operanto as merely a chatbot, a shared inbox, a social
media tool, a workflow engine, a content generator, or a CRM replacement.
Operanto integrates with such systems; its value is the continuity between
them.

## Public capability model

Customer-facing functionality is always grouped under these capabilities.
Inside the application, short navigation labels ("Conversations", "Workflows")
are preferred; page headings may use the full form ("Operanto Conversations").

| Capability | Covers |
|---|---|
| **Operanto Memory** | Company knowledge, customer identity and history, products and services, preferences, orders, quotations, policies, organisational instructions |
| **Operanto Conversations** | WhatsApp, Instagram, Facebook, email, website chat, voice, unified inbox, customer timeline, AI-assisted replies, human handover |
| **Operanto Workflows** | Tasks, approvals, assignments, follow-ups, escalations, CRM actions, service and commerce workflows, audit trails |
| **Operanto Intelligence** | Intent and customer recognition, next-best-action, opportunity detection, conversation analysis, AI-human coordination, operational insights |
| **Operanto Growth** | Brand intelligence, campaigns, social content, emails, advertisements, multilingual content, promotions, lead reactivation |
| **Operanto Computer** | Governed observation and operation of external software interfaces (browser-based systems without a suitable API), always inside approvals, audit, and human control |
| **Operanto Integrations** | CRM, ERP, e-commerce, social media, messaging, ticketing, calendars, logistics, payments, custom APIs |

Today's cockpit (customers, opportunities, tasks, activity, the Pronatona
integration, audit) lives inside Memory, Workflows, Intelligence, and
Integrations. Conversations and Growth are reserved capability names for
surfaces that are not yet in the current product; ship them under these names,
not under new brands. Computer is likewise reserved (C0, 2026-08-07 —
documented, dormant; see `docs/operanto-computer-capability.md`).

Any customer-facing architecture diagram shows Operanto with its capabilities:

```text
Operanto
├── Memory
├── Conversations
├── Workflows
├── Intelligence
├── Computer
├── Growth
└── Integrations
```

Internal technical documentation may additionally show the underlying engines.

## Internal engines (historical names)

Earlier iterations of the platform used standalone product names. These are
now **internal architectural concepts only**:

| Internal name | Responsibility | Public capability |
|---|---|---|
| `mediasync` | Social/messaging channel connectors, inbox aggregation, message normalisation, interaction ingestion | Operanto Conversations |
| `synco` | AI-human orchestration, routing, customer recognition, context assembly, human handover | Operanto Intelligence |
| `opsync` | Workflow orchestration, task assignment, approvals, escalation rules, operational events, audit trails | Operanto Workflows |
| `brandforge` | Brand profile extraction, tone and style rules, campaign and content generation | Operanto Growth |

Current state (audited 2026-08-01): **none of these names appear anywhere in
the deployed codebase** — not in source, docs, seeds, metadata, routes, or the
archived `legacy/chat-cockpit-prototype`. They survive only on the unmerged
`mediasync-communication-layer` prototype branch and in git history. No public
routes for them ever shipped on `operanto.ai`, so no redirects are required.

The internal names may be reused for bounded contexts, services, queues,
packages, or database identifiers where that improves architectural clarity.
When one exists, do not rename it destructively for branding reasons — map it
to its display name at the presentation edge instead:

```ts
const capabilityLabels = {
  mediasync: "Operanto Conversations",
  synco: "Operanto Intelligence",
  opsync: "Operanto Workflows",
  brandforge: "Operanto Growth",
} as const;
```

## Naming rules

Internal names (`mediasync`, `synco`, `opsync`, `brandforge`, and any future
engine codenames) may appear in: package/module/service names, event types,
queue names, environment variables, database identifiers, code comments, and
internal documentation — with a comment or doc line explaining their role
inside Operanto.

They must **not** appear in: UI strings, navigation, page titles or metadata,
SEO content and sitemaps, onboarding or pricing, customer-facing API response
fields (unless technically unavoidable), demo/seed content shown to customers,
or marketing and sales material. They are never presented as separately
licensed products.

Acceptable: "Operanto Conversations" as a page heading · "Conversations" in
the sidebar · a `src/lib/channels/` module internally documented as the
mediasync engine · `opsync.task.assigned` as an internal event type.

Unacceptable: "Powered by MediaSync" in the footer · "Synco AI" as a feature
card · `"product": "opsync"` in a public API response · a "BrandForge Pro"
pricing tier · `/mediasync` as a marketed landing page.

If a legacy-branded surface ever needs resurrecting, route it into the
capability model (`/mediasync → conversations`, `/synco → intelligence`,
`/opsync → workflows`, `/brandforge → growth`) with permanent redirects rather
than reviving the brand.

## Translations

The product name "Operanto" is never translated. Capability names are
translated naturally per language; suggested German forms: Wissen und Kontext
(Memory), Kundenkommunikation (Conversations), Arbeitsabläufe (Workflows),
Intelligenz (Intelligence), Wachstum (Growth), Integrationen (Integrations).
The current app ships English only; apply this table when localisation lands.

## Policy for future naming

> New features must be introduced as Operanto capabilities. New standalone
> product names require an explicit strategic decision and must not be
> introduced through implementation convenience alone.
