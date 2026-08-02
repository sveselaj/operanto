import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import {
  adminCredentials,
  buildLeadCreatedEnvelope,
  login,
  postSignedEvent,
  waitForEventProcessed,
} from "./helpers";

/**
 * Conversations foundation, end to end: deterministic simulator ingestion →
 * cockpit list and detail → customer linking → assignment → notes → status
 * and priority → activity timeline → audit log.
 *
 * The simulator runs as a local script against the same database as the app,
 * so this spec only runs locally/CI — not against a deployed base URL.
 */

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "simulator ingestion needs local database access",
);

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Ingest a simulator scenario and return the conversation id. */
function ingestScenario(scenario: "nagelista" | "pronatona", runId: string): string {
  const output = execFileSync(
    "pnpm",
    ["tsx", "scripts/simulate-conversation.ts", "--scenario", scenario, "--run", runId],
    {
      env: { ...process.env, NODE_OPTIONS: "--require ./scripts/preload.cjs" },
      encoding: "utf8",
    },
  );
  const match = output.match(/conversation (\w+)/);
  if (!match) throw new Error(`Unexpected simulator output: ${output}`);
  return match[1]!;
}

async function screenshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/**
 * A previous run on the same database may have taught the sender's channel
 * identity, in which case the freshly ingested conversation arrives already
 * linked. Unlink first so the manual-link path is exercised every run.
 */
async function ensureUnlinked(page: Page) {
  const unlink = page.getByRole("button", { name: "Unlink customer" });
  if (await unlink.isVisible().catch(() => false)) {
    await unlink.click();
    await page.getByText("Not linked to a customer record.").waitFor();
  }
}

test.describe.serial("conversations foundation", () => {
  test("Nagelista flow: ingest, open, link, assign, note, status", async ({
    page,
    request,
  }) => {
    // A customer to link, created through the real ingestion pipeline.
    const customerName = `Nagelista Customer ${run}`;
    const envelope = buildLeadCreatedEnvelope({
      leadId: `lead_nagelista_${run}`,
      customerName,
      customerEmail: `nagelista.${run}@example.com`,
      message: "Conversations e2e fixture (Nagelista)",
    });
    expect((await postSignedEvent(request, envelope)).status()).toBe(202);
    await waitForEventProcessed(request, String(envelope.eventId));

    const conversationId = ingestScenario("nagelista", run);

    const admin = adminCredentials();
    await login(page, admin.email, admin.password);

    // The list shows the simulated conversation.
    await page.goto("/conversations");
    await expect(
      page.getByRole("link", { name: /Order status — nail set/ }).first(),
    ).toBeVisible();
    await screenshot(page, "conversations-list");

    // Detail: the inbound message is there, unlinked counterpart shown.
    await page.goto(`/conversations/${conversationId}`);
    await expect(
      page.getByText("Can you tell me whether it has been shipped?"),
    ).toBeVisible();
    await ensureUnlinked(page);
    await expect(page.getByText("Not linked to a customer record.")).toBeVisible();

    // Link the customer.
    await page.getByLabel("Customer to link").selectOption({ label: customerName });
    await page.getByRole("button", { name: "Link customer" }).click();
    await expect(
      page.getByRole("link", { name: customerName }),
    ).toBeVisible();

    // Assign to the first active member.
    await page.getByLabel("Assignee").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText("Conversation reassigned").first()).toBeVisible();

    // Internal note.
    await page.getByLabel("Internal note").fill("Check shipment status with fulfilment.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(
      page.getByText("Check shipment status with fulfilment."),
    ).toBeVisible();

    // Status change.
    await page.getByLabel("Status").selectOption("PENDING");
    await page.getByRole("button", { name: "Set status" }).click();
    await expect(page.getByLabel("Status")).toHaveValue("PENDING");
    await screenshot(page, "conversation-detail");

    // And it appears under the matching list filter.
    await page.goto("/conversations?status=PENDING");
    await expect(
      page.getByRole("link", { name: /Order status — nail set/ }).first(),
    ).toBeVisible();
  });

  test("Pronatona flow: ingest, link, assign, priority, note, timeline, audit", async ({
    page,
    request,
  }) => {
    const buyerName = `Pronatona Buyer ${run}`;
    const envelope = buildLeadCreatedEnvelope({
      leadId: `lead_pronatona_conv_${run}`,
      customerName: buyerName,
      customerEmail: `pronatona.buyer.${run}@example.com`,
      message: "Conversations e2e fixture (Pronatona)",
    });
    expect((await postSignedEvent(request, envelope)).status()).toBe(202);
    await waitForEventProcessed(request, String(envelope.eventId));

    const conversationId = ingestScenario("pronatona", run);

    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await page.goto(`/conversations/${conversationId}`);
    await expect(
      page.getByText("apartment in Prishtina with two bedrooms"),
    ).toBeVisible();

    // Link the buyer created through the ingestion pipeline.
    await ensureUnlinked(page);
    await page.getByLabel("Customer to link").selectOption({ label: buyerName });
    await page.getByRole("button", { name: "Link customer" }).click();
    await expect(page.getByRole("link", { name: buyerName })).toBeVisible();

    // Assign, prioritise, and capture the requirement as a note.
    await page.getByLabel("Assignee").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText("Conversation reassigned").first()).toBeVisible();

    await page.getByLabel("Priority").selectOption("URGENT");
    await page.getByRole("button", { name: "Set priority" }).click();
    await expect(page.getByLabel("Priority")).toHaveValue("URGENT");

    await page
      .getByLabel("Internal note")
      .fill("Two bedrooms in Prishtina, budget up to €150,000.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(
      page.getByText("Two bedrooms in Prishtina, budget up to €150,000."),
    ).toBeVisible();

    // The activity timeline reflects every step.
    for (const summary of [
      "Conversation linked to customer",
      "Conversation reassigned",
      "Priority changed from NORMAL to URGENT",
      "Internal note added",
    ]) {
      await expect(page.getByText(summary).first()).toBeVisible();
    }

    // And the audit log carries the trail (types only — no content).
    await page.goto("/audit?target=Conversation");
    for (const eventType of [
      "conversation.customer_linked",
      "conversation.priority_changed",
      "conversation.note_added",
    ]) {
      await expect(page.getByText(eventType).first()).toBeVisible();
    }

    // Slice 2: linking taught the sender's channel identity, so the NEXT
    // inbound message from the same sender auto-links — and the context
    // panel shows the prior conversation.
    const followUpId = ingestScenario("pronatona", `${run}b`);
    await page.goto(`/conversations/${followUpId}`);
    await expect(page.getByRole("link", { name: buyerName })).toBeVisible();
    await expect(page.getByText("Customer context")).toBeVisible();
    await expect(page.getByText("Prior conversations")).toBeVisible();
    await expect(page.getByText("Known channel identities")).toBeVisible();
    await screenshot(page, "conversation-customer-context");
  });
});
