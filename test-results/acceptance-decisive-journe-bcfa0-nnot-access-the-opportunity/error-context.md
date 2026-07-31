# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acceptance.spec.ts >> decisive journey >> a different organisation cannot access the opportunity
- Location: tests/e2e/acceptance.spec.ts:162:7

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 90000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/dashboard" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - link "Operanto" [ref=e4] [cursor=pointer]:
        - /url: /
      - generic [ref=e5]:
        - heading "Sign in" [level=1] [ref=e6]
        - paragraph [ref=e7]: Access is by invitation. Contact your administrator if you need an account.
        - generic [ref=e8]:
          - generic [ref=e9]:
            - generic [ref=e10]: Email
            - textbox "Email" [ref=e11]
          - generic [ref=e12]:
            - generic [ref=e13]: Password
            - textbox "Password" [ref=e14]
          - alert [ref=e15]: Invalid email or password.
          - button "Sign in" [ref=e16]
  - alert [ref=e17]
```

# Test source

```ts
  64  |       propertyReference: input.propertyReference ?? "PRN-E2E-001",
  65  |       assignedAgentId: null,
  66  |       property: {
  67  |         id: `prop_${input.leadId}`,
  68  |         referenceCode: input.propertyReference ?? "PRN-E2E-001",
  69  |         title: "E2E Test Property",
  70  |         status: "ACTIVE",
  71  |         price: 100000,
  72  |         currency: "EUR",
  73  |         city: "Prishtinë",
  74  |         publicUrl: "https://pronatona.com/sq/prona/e2e-test-property",
  75  |         thumbnailUrl: null,
  76  |       },
  77  |     },
  78  |   };
  79  | }
  80  | 
  81  | export async function postSignedEvent(
  82  |   request: APIRequestContext,
  83  |   envelope: Record<string, unknown>,
  84  |   options: { secret?: string; timestampOffsetSeconds?: number } = {},
  85  | ) {
  86  |   const rawBody = JSON.stringify(envelope);
  87  |   const timestamp = String(
  88  |     Math.floor(Date.now() / 1000) + (options.timestampOffsetSeconds ?? 0),
  89  |   );
  90  |   const signature = createHmac("sha256", options.secret ?? webhookSecret())
  91  |     .update(`${timestamp}.${rawBody}`)
  92  |     .digest("hex");
  93  |   return request.post(apiUrl(EVENTS_PATH), {
  94  |     headers: {
  95  |       "Content-Type": "application/json",
  96  |       "X-Operanto-Event-Id": String(envelope.eventId),
  97  |       "X-Operanto-Timestamp": timestamp,
  98  |       "X-Operanto-Signature": signature,
  99  |     },
  100 |     data: rawBody,
  101 |   });
  102 | }
  103 | 
  104 | /**
  105 |  * Wait until a specific event reaches PROCESSED, driving the REAL retry sweep
  106 |  * on the way (the same CRON-protected mechanism staging uses).
  107 |  *
  108 |  * Deliberately per-event rather than "global health is green": unrelated
  109 |  * dead-lettered rows left by other tests must not make every later run fail,
  110 |  * and a green global count must not be mistaken for "my event worked".
  111 |  */
  112 | export async function waitForEventProcessed(
  113 |   request: APIRequestContext,
  114 |   eventId: string,
  115 | ) {
  116 |   const cronSecret = process.env.CRON_SECRET;
  117 |   if (!cronSecret) throw new Error("CRON_SECRET missing in env");
  118 |   const auth = { Authorization: `Bearer ${cronSecret}` };
  119 | 
  120 |   let lastStatus = "unknown";
  121 |   for (let attempt = 0; attempt < 20; attempt++) {
  122 |     const res = await request.get(
  123 |       apiUrl(`/api/internal/events/status?eventId=${encodeURIComponent(eventId)}`),
  124 |       { headers: auth },
  125 |     );
  126 |     if (res.ok()) {
  127 |       const body = (await res.json()) as {
  128 |         found: boolean;
  129 |         processingStatus?: string;
  130 |       };
  131 |       lastStatus = body.processingStatus ?? "absent";
  132 |       if (body.processingStatus === "PROCESSED") return;
  133 |       if (body.processingStatus === "DEAD_LETTER") {
  134 |         throw new Error(`event ${eventId} dead-lettered`);
  135 |       }
  136 |     }
  137 |     // Nudge the real sweep, then wait before re-checking.
  138 |     await request.post(apiUrl("/api/internal/events/retry"), { headers: auth });
  139 |     await new Promise((resolve) => setTimeout(resolve, 1000));
  140 |   }
  141 |   throw new Error(`event ${eventId} not processed (last status: ${lastStatus})`);
  142 | }
  143 | 
  144 | /** Aggregate worker health (used to assert the sweep endpoint itself works). */
  145 | export async function workerHealth(request: APIRequestContext) {
  146 |   const cronSecret = process.env.CRON_SECRET;
  147 |   if (!cronSecret) throw new Error("CRON_SECRET missing in env");
  148 |   const res = await request.get(apiUrl("/api/health/worker"), {
  149 |     headers: { Authorization: `Bearer ${cronSecret}` },
  150 |   });
  151 |   return (await res.json()) as {
  152 |     ok: boolean;
  153 |     pending: number;
  154 |     retryable: number;
  155 |     deadLetter: number;
  156 |   };
  157 | }
  158 | 
  159 | export async function login(page: Page, email: string, password: string) {
  160 |   await page.goto("/login");
  161 |   await page.getByLabel("Email").fill(email);
  162 |   await page.getByLabel("Password").fill(password);
  163 |   await page.getByRole("button", { name: "Sign in" }).click();
> 164 |   await page.waitForURL("**/dashboard");
      |              ^ Error: page.waitForURL: Test timeout of 90000ms exceeded.
  165 | }
  166 | 
  167 | export function adminCredentials() {
  168 |   const email = process.env.SEED_ADMIN_EMAIL;
  169 |   const password = process.env.SEED_ADMIN_PASSWORD;
  170 |   if (!email || !password) throw new Error("SEED_ADMIN_* missing in env");
  171 |   return { email, password };
  172 | }
  173 | 
  174 | /**
  175 |  * Fixture credentials come from the environment — the same variables the seed
  176 |  * requires. Nothing here is a hardcoded, committed password.
  177 |  */
  178 | function requiredEnv(name: string): string {
  179 |   const value = process.env[name];
  180 |   if (!value) throw new Error(`${name} missing in env (required for e2e)`);
  181 |   return value;
  182 | }
  183 | 
  184 | export function operatorCredentials() {
  185 |   return {
  186 |     email: "operator@operanto.local",
  187 |     password: requiredEnv("SEED_TEST_OPERATOR_PASSWORD"),
  188 |   };
  189 | }
  190 | 
  191 | export const FOREIGN_ADMIN = {
  192 |   email: "admin@isolation-test.local",
  193 |   password: () => requiredEnv("SEED_TEST_ISOLATION_ADMIN_PASSWORD"),
  194 | };
  195 | 
```