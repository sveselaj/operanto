import { expect, test } from "@playwright/test";
import {
  adminCredentials,
  buildLeadCreatedEnvelope,
  FOREIGN_ADMIN,
  login,
  OPERATOR,
  postSignedEvent,
  processPendingEvents,
} from "./helpers";

/**
 * The decisive journey, end to end, through the REAL ingestion route and the
 * REAL authenticated Cockpit:
 * signed lead.created → 202 → projection → dashboard → opportunity page
 * (customer, inquiry, property, timeline, follow-up task) → replay produces no
 * duplicates → cross-tenant access 404s → operator scoping enforced →
 * integration health reflects the processed event.
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const leadId = `lead_e2e_${run}`;
const customerName = `E2E Customer ${run}`;
const customerEmail = `e2e.${run}@example.com`;
const propertyReference = `PRN-E2E-${run.toUpperCase().slice(0, 6)}`;

let envelope: ReturnType<typeof buildLeadCreatedEnvelope>;
let opportunityUrl = "";

test.describe.serial("decisive journey", () => {
  test("valid signed event is accepted; replay is an idempotent duplicate", async ({
    request,
  }) => {
    envelope = buildLeadCreatedEnvelope({
      leadId,
      customerName,
      customerEmail,
      propertyReference,
    });
    const first = await postSignedEvent(request, envelope);
    expect(first.status()).toBe(202);

    const replay = await postSignedEvent(request, envelope);
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });

    const badSignature = await postSignedEvent(request, envelope, {
      secret: "0".repeat(48),
    });
    expect(badSignature.status()).toBe(401);

    const expired = await postSignedEvent(request, envelope, {
      timestampOffsetSeconds: -3600,
    });
    expect(expired.status()).toBe(401);

    // The retry cron requires authentication…
    const unauthenticated = await request.post("/api/internal/events/retry");
    expect(unauthenticated.status()).toBe(401);
    // …and with it, processing completes through the real sweep path.
    await processPendingEvents(request);
  });

  test("administrator sees the opportunity with full context", async ({ page }) => {
    const { email, password } = adminCredentials();
    await login(page, email, password);

    // Dashboard lists the new opportunity.
    await expect(
      page.getByRole("link", { name: new RegExp(customerName) }).first(),
    ).toBeVisible();

    // Opportunity list → detail.
    await page.goto("/opportunities");
    await page.getByRole("link", { name: customerName }).first().click();
    await page.waitForURL("**/opportunities/**");
    opportunityUrl = new URL(page.url()).pathname;

    // Customer, inquiry, property context, timeline, follow-up task.
    await expect(page.getByText(customerEmail)).toBeVisible();
    await expect(
      page.getByText("E2E acceptance inquiry — please respond."),
    ).toBeVisible();
    await expect(page.getByText(propertyReference).first()).toBeVisible();
    await expect(page.getByText("Property inquiry received")).toBeVisible();
    await expect(page.getByText("Customer record created")).toBeVisible();
    await expect(
      page.getByText("Respond to new property inquiry").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /View on Pronatona/ }),
    ).toBeVisible();
  });

  test("replayed event created no duplicate rows", async ({ page, request }) => {
    const replay = await postSignedEvent(request, envelope);
    expect(replay.status()).toBe(200);

    const { email, password } = adminCredentials();
    await login(page, email, password);
    await page.goto("/opportunities");
    await expect(page.getByRole("link", { name: customerName })).toHaveCount(1);
    await page.goto("/customers?q=" + encodeURIComponent(customerEmail));
    await expect(page.getByRole("link", { name: customerName })).toHaveCount(1);
  });

  test("integration health reflects the processed event", async ({ page }) => {
    const { email, password } = adminCredentials();
    await login(page, email, password);
    await page.goto("/integrations/pronatona");
    await expect(page.getByText(String(envelope.eventId))).toBeVisible();
    await expect(page.getByText("PROCESSED").first()).toBeVisible();
  });

  test("a different organisation cannot access the opportunity", async ({ page }) => {
    await login(page, FOREIGN_ADMIN.email, FOREIGN_ADMIN.password);
    const response = await page.goto(opportunityUrl);
    expect(response?.status()).toBe(404);
  });

  test("an OPERATOR cannot access an unassigned opportunity", async ({ page }) => {
    await login(page, OPERATOR.email, OPERATOR.password);

    // Not in their list…
    await page.goto("/opportunities");
    await expect(page.getByRole("link", { name: customerName })).toHaveCount(0);

    // …and not via direct URL either.
    const response = await page.goto(opportunityUrl);
    expect(response?.status()).toBe(404);

    // Operator also has no admin surfaces.
    await page.goto("/settings/users");
    await page.waitForURL("**/dashboard");
    await page.goto("/audit");
    await page.waitForURL("**/dashboard");
  });
});
