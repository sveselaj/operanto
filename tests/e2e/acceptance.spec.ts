import { expect, test } from "@playwright/test";
import {
  adminCredentials,
  buildLeadCreatedEnvelope,
  FOREIGN_ADMIN,
  login,
  operatorCredentials,
  postSignedEvent,
  waitForEventProcessed,
  workerHealth,
} from "./helpers";

/**
 * The decisive journey, end to end, through the REAL ingestion route and the
 * REAL authenticated Cockpit:
 * signed lead.created → 202 → projection → dashboard → opportunity page
 * (customer, inquiry, property, timeline, follow-up task) → replay produces no
 * duplicates → cross-tenant access 404s → operator scoping enforced →
 * integration health reflects the processed event.
 *
 * Every assertion is anchored to content that only exists when the feature
 * actually worked (unique per-run strings, table rows, positive controls),
 * so a regression cannot pass silently.
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const leadId = `lead_e2e_${run}`;
const customerName = `E2E Customer ${run}`;
const customerEmail = `e2e.${run}@example.com`;
const inquiryText = `E2E acceptance inquiry ${run} — please respond.`;
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
      message: inquiryText,
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

    // Wrong source organisation is signed correctly but must be refused.
    const foreignOrg = await postSignedEvent(request, {
      ...buildLeadCreatedEnvelope({
        leadId: `${leadId}_foreign`,
        customerName,
        customerEmail,
      }),
      organisationId: "org_not_registered",
    });
    expect(foreignOrg.status()).toBe(409);

    // The retry cron requires authentication…
    const unauthenticated = await request.post("/api/internal/events/retry");
    expect(unauthenticated.status()).toBe(401);
    const unauthenticatedStatus = await request.get(
      "/api/internal/events/status?eventId=x",
    );
    expect(unauthenticatedStatus.status()).toBe(401);

    // …and this specific event reaches PROCESSED.
    await waitForEventProcessed(request, String(envelope.eventId));
  });

  test("administrator sees the opportunity with full context", async ({ page }) => {
    const { email, password } = adminCredentials();
    await login(page, email, password);

    // Positive control: the dashboard rendered (not an error page).
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(customerName) }).first(),
    ).toBeVisible();

    // Opportunity list → detail.
    await page.goto("/opportunities");
    await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
    await page.getByRole("link", { name: customerName }).first().click();
    await page.waitForURL("**/opportunities/**");
    opportunityUrl = new URL(page.url()).pathname;

    // Customer, inquiry, property context, timeline, follow-up task —
    // each anchored to per-run unique content.
    await expect(page.getByText(customerEmail)).toBeVisible();
    await expect(page.getByText(inquiryText)).toBeVisible();
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

  test("integration health reflects the processed event", async ({
    page,
    request,
  }) => {
    // Authoritative check: this event's own row says PROCESSED.
    const status = await request.get(
      `/api/internal/events/status?eventId=${encodeURIComponent(String(envelope.eventId))}`,
      { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
    );
    expect(await status.json()).toMatchObject({
      found: true,
      processingStatus: "PROCESSED",
      eventType: "lead.created",
    });

    const health = await workerHealth(request);
    expect(health.pending).toBe(0);

    // And the admin screen shows that row with its status (scoped to the row,
    // not to the always-present "Processed" summary tile).
    const { email, password } = adminCredentials();
    await login(page, email, password);
    await page.goto("/integrations/pronatona");
    const row = page.locator("tr", { hasText: String(envelope.eventId) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("PROCESSED", { exact: true })).toBeVisible();
  });

  test("a different organisation cannot access the opportunity", async ({ page }) => {
    await login(page, FOREIGN_ADMIN.email, FOREIGN_ADMIN.password());
    const response = await page.goto(opportunityUrl);
    expect(response?.status()).toBe(404);
  });

  test("an OPERATOR cannot access an unassigned opportunity", async ({ page }) => {
    const operator = operatorCredentials();
    await login(page, operator.email, operator.password);

    // Positive control: the operator's own pages render normally…
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.goto("/opportunities");
    await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
    await expect(page.getByText("No opportunities match this view.")).toBeVisible();

    // …but the unassigned opportunity is absent from the list…
    await expect(page.getByRole("link", { name: customerName })).toHaveCount(0);

    // …and unreachable by direct URL.
    const response = await page.goto(opportunityUrl);
    expect(response?.status()).toBe(404);

    // Operator also has no admin surfaces.
    await page.goto("/settings/users");
    await page.waitForURL("**/dashboard");
    await page.goto("/audit");
    await page.waitForURL("**/dashboard");
  });
});
