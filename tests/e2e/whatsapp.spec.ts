import { createHmac } from "node:crypto";
import http from "node:http";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminCredentials, apiBase, buildLeadCreatedEnvelope, login, postSignedEvent, waitForEventProcessed } from "./helpers";

/**
 * WhatsApp Cloud, end to end against the REAL webhook route and the real
 * cockpit. Meta's Graph API is replaced by a local mock server (the spec
 * process hosts it; the app reaches it via META_GRAPH_BASE_URL, which is only
 * honoured outside production). Inbound webhooks are genuinely signed with
 * the deployment-level app secret — signature verification, tenant routing,
 * the canonical pipeline, consent, the service window and the explicit send
 * operation all run for real. No live Meta connectivity is required.
 */

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "whatsapp e2e needs the local mock Graph server and local env flags",
);

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const APP_SECRET = process.env.META_APP_SECRET ?? "e2e-meta-app-secret";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "e2e-verify-token";
const GRAPH_PORT = 4545;
const PHONE_NUMBER_ID = `pn-e2e-${run}`;

const nagelistaWaId = `35569${Date.now() % 100000}1`;
const pronatonaWaId = `35569${Date.now() % 100000}2`;

type GraphSend = { path: string; body: Record<string, unknown> };
const graphSends: GraphSend[] = [];
let graphServer: http.Server;
let wamidCounter = 0;

test.beforeAll(async () => {
  graphServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url?.endsWith("/messages")) {
        graphSends.push({ path: req.url, body: JSON.parse(raw || "{}") });
        wamidCounter += 1;
        res.end(JSON.stringify({ messages: [{ id: `wamid.e2e-${run}-${wamidCounter}` }] }));
        return;
      }
      // Connection verification reads the phone-number resource.
      res.end(JSON.stringify({ display_phone_number: "+355 69 E2E" }));
    });
  });
  await new Promise<void>((resolve) => graphServer.listen(GRAPH_PORT, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    graphServer.close((err) => (err ? reject(err) : resolve())),
  );
});

function waPayload(value: Record<string, unknown>) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: `waba-e2e-${run}`,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                phone_number_id: PHONE_NUMBER_ID,
                display_phone_number: "+355 69 E2E",
              },
              ...value,
            },
          },
        ],
      },
    ],
  });
}

function waTextPayload(waId: string, name: string, body: string) {
  return waPayload({
    contacts: [{ wa_id: waId, profile: { name } }],
    messages: [
      {
        from: waId,
        id: `wamid.in-${run}-${Math.random().toString(36).slice(2)}`,
        timestamp: `${Math.floor(Date.now() / 1000)}`,
        type: "text",
        text: { body },
      },
    ],
  });
}

function waStatusPayload(wamid: string, status: string) {
  return waPayload({ statuses: [{ id: wamid, status }] });
}

async function postWebhook(
  request: APIRequestContext,
  rawBody: string,
  options: { unsigned?: boolean } = {},
) {
  const digest = createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
  return request.post(`${apiBase()}/api/webhooks/whatsapp`, {
    data: rawBody,
    headers: {
      "content-type": "application/json",
      ...(options.unsigned ? {} : { "x-hub-signature-256": `sha256=${digest}` }),
    },
  });
}

/** Processing happens via after(); poll the cockpit until projection lands. */
async function openConversationByText(page: Page, text: string | RegExp) {
  await expect
    .poll(
      async () => {
        await page.goto("/conversations");
        return page
          .getByRole("link", { name: text })
          .first()
          .isVisible()
          .catch(() => false);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.getByRole("link", { name: text }).first().click();
  await page.waitForURL("**/conversations/**");
}

test.describe.serial("WhatsApp Cloud", () => {
  test("webhook handshake, signature enforcement, connection setup", async ({
    page,
    request,
  }) => {
    // Meta subscription handshake.
    const ok = await request.get(
      `${apiBase()}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=e2e-challenge-${run}`,
    );
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe(`e2e-challenge-${run}`);
    const badToken = await request.get(
      `${apiBase()}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`,
    );
    expect(badToken.status()).toBe(403);

    // Signature is enforced before anything else.
    const unsigned = await postWebhook(request, waTextPayload("1", "X", "hi"), {
      unsigned: true,
    });
    expect(unsigned.status()).toBe(401);

    // An unknown phone_number_id is acknowledged but never routed.
    const unknown = await postWebhook(
      request,
      waTextPayload(nagelistaWaId, "Ghost", "hello").replace(PHONE_NUMBER_ID, "pn-ghost"),
    );
    expect(unknown.status()).toBe(200);
    expect(await unknown.json()).toMatchObject({ ignored: "unresolvable_tenant" });

    // Admin connects the organisation's number; the mock Graph verifies it.
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await page.goto("/integrations");
    await page.getByPlaceholder("WhatsApp Business Account ID").fill(`waba-e2e-${run}`);
    await page.getByPlaceholder("Phone number ID").fill(PHONE_NUMBER_ID);
    await page.getByPlaceholder("Display phone number").fill(`+355 69 ${run}`);
    await page.getByPlaceholder("System-user access token").fill(`e2e-token-${run}`);
    await page.getByRole("button", { name: "Connect WhatsApp number" }).click();
    await expect(page.getByText("Connection saved and verified")).toBeVisible();

    // Stage gates: enable inbound, then outbound — explicit, separate steps.
    // Scoped to THIS run's connection row: reruns on a shared database leave
    // earlier connections behind, each with its own gate buttons.
    const row = page.getByTestId(`connection-WHATSAPP-${PHONE_NUMBER_ID}`);
    await row.getByRole("button", { name: "Enable inbound" }).click();
    await expect(row.getByText("inbound on")).toBeVisible();
    await row.getByRole("button", { name: "Enable outbound" }).click();
    await expect(row.getByText("outbound on")).toBeVisible();
  });

  test("Nagelista: enquiry → known customer → draft → RECORDED → explicit send → callbacks → task", async ({
    page,
    request,
  }) => {
    // The known customer exists through the real ingestion pipeline.
    const customerName = `Wa Nagelista ${run}`;
    const envelope = buildLeadCreatedEnvelope({
      leadId: `lead_wa_nag_${run}`,
      customerName,
      customerEmail: `wa.nag.${run}@example.com`,
      message: "WhatsApp e2e fixture (Nagelista)",
    });
    expect((await postSignedEvent(request, envelope)).status()).toBe(202);
    await waitForEventProcessed(request, String(envelope.eventId));

    // Inbound WhatsApp shipping enquiry.
    const inbound = await postWebhook(
      request,
      waTextPayload(
        nagelistaWaId,
        `Wa Blerina ${run}`,
        "I ordered a nail set last week. Can you tell me whether it has been shipped?",
      ),
    );
    expect(inbound.status()).toBe(200);

    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await openConversationByText(page, new RegExp(`Wa Blerina ${run}`));
    await expect(
      page.getByText("Can you tell me whether it has been shipped?"),
    ).toBeVisible();

    // Resolve the known customer; order-related context appears.
    await page.getByLabel("Customer to link").selectOption({ label: customerName });
    await page.getByRole("button", { name: "Link customer" }).click();
    await expect(page.getByRole("link", { name: customerName })).toBeVisible();

    // AI-assisted draft in MOCK mode — approving records locally, never sends.
    await page.getByRole("button", { name: "Summarise" }).click();
    await expect(
      page.getByText("No shipment information is available in this conversation."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Draft reply", exact: true }).click();
    await expect(page.getByText("Missing information:")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("APPROVED", { exact: false }).first()).toBeVisible();
    const sendsBeforeApproval = graphSends.length;

    // The human explicitly chooses Send — a separate operation with its own
    // panel; the service window is open because the customer just wrote.
    const reply = `Faleminderit! Porosia juaj u nis sot. (${run})`;
    await expect(page.getByTestId("whatsapp-send-panel")).toBeVisible();
    await expect(page.getByText("Service window open")).toBeVisible();
    await page.getByLabel("WhatsApp message").fill(reply);
    await page.getByRole("button", { name: "Send WhatsApp message" }).click();
    await expect(page.getByText("Message sent.")).toBeVisible();

    // Approval alone transmitted nothing; the explicit send transmitted once.
    expect(graphSends.length).toBe(sendsBeforeApproval + 1);
    const sent = graphSends.at(-1)!;
    expect(sent.path).toContain(`/${PHONE_NUMBER_ID}/messages`);
    expect(sent.body).toMatchObject({ to: nagelistaWaId, type: "text" });
    await expect(page.getByText(reply)).toBeVisible();
    await expect(page.getByText("· sent").first()).toBeVisible();

    // Provider callbacks: sent → delivered → read, monotonic.
    const wamid = `wamid.e2e-${run}-${wamidCounter}`;
    for (const status of ["sent", "delivered", "read"]) {
      expect((await postWebhook(request, waStatusPayload(wamid, status))).status()).toBe(
        200,
      );
    }
    await expect
      .poll(
        async () => {
          await page.reload();
          return page
            .getByText("· read")
            .first()
            .isVisible()
            .catch(() => false);
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    // A separate delivery follow-up task.
    const taskTitle = `Confirm delivery arrived ${run}`;
    await page.getByLabel("Task title").fill(taskTitle);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText(taskTitle).first()).toBeVisible();
  });

  test("Pronatona: enquiry → teach identity → recognition → explicit send → continuity", async ({
    page,
    request,
  }) => {
    const buyerName = `Wa Buyer ${run}`;
    const envelope = buildLeadCreatedEnvelope({
      leadId: `lead_wa_pro_${run}`,
      customerName: buyerName,
      customerEmail: `wa.pro.${run}@example.com`,
      message: "WhatsApp e2e fixture (Pronatona)",
    });
    expect((await postSignedEvent(request, envelope)).status()).toBe(202);
    await waitForEventProcessed(request, String(envelope.eventId));

    // New property enquiry over WhatsApp.
    expect(
      (
        await postWebhook(
          request,
          waTextPayload(
            pronatonaWaId,
            `Wa Artan ${run}`,
            "Pershendetje, a eshte i lire apartamenti ne Ulqin?",
          ),
        )
      ).status(),
    ).toBe(200);

    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await openConversationByText(page, new RegExp(`Wa Artan ${run}`));
    await expect(
      page.getByText("Pershendetje, a eshte i lire apartamenti ne Ulqin?"),
    ).toBeVisible();

    // Link the buyer — teaching the WhatsApp identity.
    await page.getByLabel("Customer to link").selectOption({ label: buyerName });
    await page.getByRole("button", { name: "Link customer" }).click();
    await expect(page.getByRole("link", { name: buyerName })).toBeVisible();

    // Second message: automatic recognition through the taught identity —
    // same conversation, still linked, prior context visible.
    expect(
      (
        await postWebhook(
          request,
          waTextPayload(pronatonaWaId, `Wa Artan ${run}`, "Mund ta shoh neser?"),
        )
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () => {
          await page.reload();
          return page
            .getByText("Mund ta shoh neser?")
            .isVisible()
            .catch(() => false);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect(page.getByRole("link", { name: buyerName })).toBeVisible();

    // Explicit human reply.
    const reply = `Po, apartamenti eshte i lire — ju pres neser. (${run})`;
    await page.getByLabel("WhatsApp message").fill(reply);
    await page.getByRole("button", { name: "Send WhatsApp message" }).click();
    await expect(page.getByText("Message sent.")).toBeVisible();
    expect(graphSends.at(-1)!.body).toMatchObject({ to: pronatonaWaId });

    // Continuity: conversation, message, activity and task on one record.
    await expect(page.getByText("WhatsApp message sent by staff").first()).toBeVisible();
    const taskTitle = `Prepare viewing documents ${run}`;
    await page.getByLabel("Task title").fill(taskTitle);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText(taskTitle).first()).toBeVisible();
  });

  test("STOP opts out and the explicit send is refused server-side", async ({
    page,
    request,
  }) => {
    expect(
      (
        await postWebhook(request, waTextPayload(pronatonaWaId, `Wa Artan ${run}`, "STOP"))
      ).status(),
    ).toBe(200);

    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    // The conversation is linked now, so the list shows the CUSTOMER's name.
    await openConversationByText(page, new RegExp(`Wa Buyer ${run}`));
    await expect
      .poll(
        async () => {
          await page.reload();
          return page
            .getByText("Customer opted out of this channel")
            .first()
            .isVisible()
            .catch(() => false);
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    const sendsBefore = graphSends.length;
    await page.getByLabel("WhatsApp message").fill("This must be refused");
    await page.getByRole("button", { name: "Send WhatsApp message" }).click();
    await expect(page.getByText("The customer has opted out of this channel")).toBeVisible();
    expect(graphSends.length).toBe(sendsBefore);

    // START restores consent for future work on this shared database.
    expect(
      (
        await postWebhook(request, waTextPayload(pronatonaWaId, `Wa Artan ${run}`, "START"))
      ).status(),
    ).toBe(200);
  });
});
