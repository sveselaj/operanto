# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acceptance.spec.ts >> decisive journey >> administrator sees the opportunity with full context
- Location: tests/e2e/acceptance.spec.ts:87:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Respond to new property inquiry').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Respond to new property inquiry').first()

```

```yaml
- complementary:
  - link "Operanto":
    - /url: /dashboard
  - navigation:
    - link "Dashboard":
      - /url: /dashboard
    - link "Customers":
      - /url: /customers
    - link "Opportunities":
      - /url: /opportunities
    - link "Tasks":
      - /url: /tasks
    - link "Activity":
      - /url: /activity
    - paragraph: Administration
    - link "Integrations":
      - /url: /integrations
    - link "Settings":
      - /url: /settings/organisation
    - link "Audit log":
      - /url: /audit
  - paragraph: Recognize. Resume. Resolve.
- banner:
  - text: Pronatona ADMIN Operanto Admin
  - button "Sign out"
- main:
  - heading "E2E Customer ms7ddw2s9068" [level=1]
  - paragraph: Inquiry about PRN-E2E-MS7DDW
  - text: "New Pronatona status: NEW Customer"
  - paragraph:
    - link "E2E Customer ms7ddw2s9068":
      - /url: /customers/cms7ddxxe0003zbsj3vx1rbqn
  - paragraph: e2e.ms7ddw2s9068@example.com
  - paragraph: No phone
  - text: "Language: sq Channel: EMAIL"
  - paragraph: "Source: website · PRONATONA_WEB"
  - text: Property
  - paragraph: E2E Test Property
  - paragraph: PRN-E2E-MS7DDW · Prishtinë
  - paragraph: €100,000
  - text: ACTIVE
  - paragraph:
    - link "View on Pronatona":
      - /url: https://pronatona.com/sq/prona/e2e-test-property
  - text: Inquiry
  - paragraph: E2E acceptance inquiry ms7ddw2s9068 — please respond.
  - text: Manage
  - combobox "Stage":
    - option "New" [selected]
    - option "Contact required"
    - option "Qualifying"
    - option "Viewing requested"
    - option "Viewing scheduled"
    - option "Offer"
    - option "Won"
    - option "Lost"
    - option "Closed"
  - button "Set stage"
  - combobox "Assignee":
    - option "Unassigned" [selected]
    - option "Operanto Admin (ADMIN)"
    - option "Test Operator (OPERATOR)"
  - button "Assign"
  - text: Timeline
  - textbox "Add an internal note…"
  - button "Add note"
  - list:
    - listitem:
      - text: Customer
      - paragraph: Property inquiry received
      - paragraph: inquiry.received · 30 Jul 2026, 12:27
    - listitem:
      - text: System
      - paragraph: Customer record created
      - paragraph: customer.created · 30 Jul 2026, 12:27
    - listitem:
      - text: System
      - paragraph: Opportunity created (PROPERTY_QUESTION)
      - paragraph: opportunity.created · 30 Jul 2026, 12:27
    - listitem:
      - text: System
      - paragraph: Property PRN-E2E-MS7DDW attached
      - paragraph: property.attached · 30 Jul 2026, 12:27
  - text: Tasks
  - textbox "New task…"
  - textbox "Due"
  - combobox "Task assignee":
    - option "Unassigned" [selected]
    - option "Operanto Admin"
    - option "Test Operator"
  - button "Create task"
  - list:
    - paragraph: No tasks yet.
- alert: Opportunity · Operanto
```

# Test source

```ts
  13  | /**
  14  |  * The decisive journey, end to end, through the REAL ingestion route and the
  15  |  * REAL authenticated Cockpit:
  16  |  * signed lead.created → 202 → projection → dashboard → opportunity page
  17  |  * (customer, inquiry, property, timeline, follow-up task) → replay produces no
  18  |  * duplicates → cross-tenant access 404s → operator scoping enforced →
  19  |  * integration health reflects the processed event.
  20  |  *
  21  |  * Every assertion is anchored to content that only exists when the feature
  22  |  * actually worked (unique per-run strings, table rows, positive controls),
  23  |  * so a regression cannot pass silently.
  24  |  */
  25  | 
  26  | const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  27  | const leadId = `lead_e2e_${run}`;
  28  | const customerName = `E2E Customer ${run}`;
  29  | const customerEmail = `e2e.${run}@example.com`;
  30  | const inquiryText = `E2E acceptance inquiry ${run} — please respond.`;
  31  | const propertyReference = `PRN-E2E-${run.toUpperCase().slice(0, 6)}`;
  32  | 
  33  | let envelope: ReturnType<typeof buildLeadCreatedEnvelope>;
  34  | let opportunityUrl = "";
  35  | 
  36  | test.describe.serial("decisive journey", () => {
  37  |   test("valid signed event is accepted; replay is an idempotent duplicate", async ({
  38  |     request,
  39  |   }) => {
  40  |     envelope = buildLeadCreatedEnvelope({
  41  |       leadId,
  42  |       customerName,
  43  |       customerEmail,
  44  |       message: inquiryText,
  45  |       propertyReference,
  46  |     });
  47  |     const first = await postSignedEvent(request, envelope);
  48  |     expect(first.status()).toBe(202);
  49  | 
  50  |     const replay = await postSignedEvent(request, envelope);
  51  |     expect(replay.status()).toBe(200);
  52  |     expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });
  53  | 
  54  |     const badSignature = await postSignedEvent(request, envelope, {
  55  |       secret: "0".repeat(48),
  56  |     });
  57  |     expect(badSignature.status()).toBe(401);
  58  | 
  59  |     const expired = await postSignedEvent(request, envelope, {
  60  |       timestampOffsetSeconds: -3600,
  61  |     });
  62  |     expect(expired.status()).toBe(401);
  63  | 
  64  |     // Wrong source organisation is signed correctly but must be refused.
  65  |     const foreignOrg = await postSignedEvent(request, {
  66  |       ...buildLeadCreatedEnvelope({
  67  |         leadId: `${leadId}_foreign`,
  68  |         customerName,
  69  |         customerEmail,
  70  |       }),
  71  |       organisationId: "org_not_registered",
  72  |     });
  73  |     expect(foreignOrg.status()).toBe(409);
  74  | 
  75  |     // The retry cron requires authentication…
  76  |     const unauthenticated = await request.post("/api/internal/events/retry");
  77  |     expect(unauthenticated.status()).toBe(401);
  78  |     const unauthenticatedStatus = await request.get(
  79  |       "/api/internal/events/status?eventId=x",
  80  |     );
  81  |     expect(unauthenticatedStatus.status()).toBe(401);
  82  | 
  83  |     // …and this specific event reaches PROCESSED.
  84  |     await waitForEventProcessed(request, String(envelope.eventId));
  85  |   });
  86  | 
  87  |   test("administrator sees the opportunity with full context", async ({ page }) => {
  88  |     const { email, password } = adminCredentials();
  89  |     await login(page, email, password);
  90  | 
  91  |     // Positive control: the dashboard rendered (not an error page).
  92  |     await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  93  |     await expect(
  94  |       page.getByRole("link", { name: new RegExp(customerName) }).first(),
  95  |     ).toBeVisible();
  96  | 
  97  |     // Opportunity list → detail.
  98  |     await page.goto("/opportunities");
  99  |     await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  100 |     await page.getByRole("link", { name: customerName }).first().click();
  101 |     await page.waitForURL("**/opportunities/**");
  102 |     opportunityUrl = new URL(page.url()).pathname;
  103 | 
  104 |     // Customer, inquiry, property context, timeline, follow-up task —
  105 |     // each anchored to per-run unique content.
  106 |     await expect(page.getByText(customerEmail)).toBeVisible();
  107 |     await expect(page.getByText(inquiryText)).toBeVisible();
  108 |     await expect(page.getByText(propertyReference).first()).toBeVisible();
  109 |     await expect(page.getByText("Property inquiry received")).toBeVisible();
  110 |     await expect(page.getByText("Customer record created")).toBeVisible();
  111 |     await expect(
  112 |       page.getByText("Respond to new property inquiry").first(),
> 113 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  114 |     await expect(
  115 |       page.getByRole("link", { name: /View on Pronatona/ }),
  116 |     ).toBeVisible();
  117 |   });
  118 | 
  119 |   test("replayed event created no duplicate rows", async ({ page, request }) => {
  120 |     const replay = await postSignedEvent(request, envelope);
  121 |     expect(replay.status()).toBe(200);
  122 | 
  123 |     const { email, password } = adminCredentials();
  124 |     await login(page, email, password);
  125 |     await page.goto("/opportunities");
  126 |     await expect(page.getByRole("link", { name: customerName })).toHaveCount(1);
  127 |     await page.goto("/customers?q=" + encodeURIComponent(customerEmail));
  128 |     await expect(page.getByRole("link", { name: customerName })).toHaveCount(1);
  129 |   });
  130 | 
  131 |   test("integration health reflects the processed event", async ({
  132 |     page,
  133 |     request,
  134 |   }) => {
  135 |     // Authoritative check: this event's own row says PROCESSED.
  136 |     const status = await request.get(
  137 |       `/api/internal/events/status?eventId=${encodeURIComponent(String(envelope.eventId))}`,
  138 |       { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
  139 |     );
  140 |     expect(await status.json()).toMatchObject({
  141 |       found: true,
  142 |       processingStatus: "PROCESSED",
  143 |       eventType: "lead.created",
  144 |     });
  145 | 
  146 |     const health = await workerHealth(request);
  147 |     expect(health.pending).toBe(0);
  148 | 
  149 |     // And the admin screen shows that row with its status (scoped to the row,
  150 |     // not to the always-present "Processed" summary tile).
  151 |     const { email, password } = adminCredentials();
  152 |     await login(page, email, password);
  153 |     await page.goto("/integrations/pronatona");
  154 |     const row = page.locator("tr", { hasText: String(envelope.eventId) });
  155 |     await expect(row).toHaveCount(1);
  156 |     await expect(row.getByText("PROCESSED", { exact: true })).toBeVisible();
  157 |   });
  158 | 
  159 |   test("a different organisation cannot access the opportunity", async ({ page }) => {
  160 |     await login(page, FOREIGN_ADMIN.email, FOREIGN_ADMIN.password());
  161 |     const response = await page.goto(opportunityUrl);
  162 |     expect(response?.status()).toBe(404);
  163 |   });
  164 | 
  165 |   test("an OPERATOR cannot access an unassigned opportunity", async ({ page }) => {
  166 |     const operator = operatorCredentials();
  167 |     await login(page, operator.email, operator.password);
  168 | 
  169 |     // Positive control: the operator's own pages render normally…
  170 |     await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  171 |     await page.goto("/opportunities");
  172 |     await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  173 |     await expect(page.getByText("No opportunities match this view.")).toBeVisible();
  174 | 
  175 |     // …but the unassigned opportunity is absent from the list…
  176 |     await expect(page.getByRole("link", { name: customerName })).toHaveCount(0);
  177 | 
  178 |     // …and unreachable by direct URL.
  179 |     const response = await page.goto(opportunityUrl);
  180 |     expect(response?.status()).toBe(404);
  181 | 
  182 |     // Operator also has no admin surfaces.
  183 |     await page.goto("/settings/users");
  184 |     await page.waitForURL("**/dashboard");
  185 |     await page.goto("/audit");
  186 |     await page.waitForURL("**/dashboard");
  187 |   });
  188 | });
  189 | 
```