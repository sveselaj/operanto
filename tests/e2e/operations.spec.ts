import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  adminCredentials,
  apiBase,
  EVENTS_PATH,
  login,
  operatorCredentials,
  sourceOrganisationId,
  webhookSecret,
} from "./helpers";

/**
 * Operational behaviours that the decisive-journey suite does not cover:
 * dead-letter escalation and admin retry, sign-out, and instant session
 * revocation — all against whichever hosts the run targets.
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** An event whose handler must fail: assignment for a lead that never existed. */
async function postUnprojectableEvent(
  request: import("@playwright/test").APIRequestContext,
  eventId: string,
) {
  const envelope = {
    eventId,
    eventType: "lead.assigned",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "PRONATONA_WEB",
    organisationId: sourceOrganisationId(),
    correlationId: eventId,
    actor: { type: "STAFF", userId: null, membershipId: null },
    data: { leadId: `lead_missing_${eventId}`, assignedAgentId: null },
  };
  const rawBody = JSON.stringify(envelope);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecret())
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return request.post(`${apiBase()}${EVENTS_PATH}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Operanto-Event-Id": eventId,
      "X-Operanto-Timestamp": timestamp,
      "X-Operanto-Signature": signature,
    },
    data: rawBody,
  });
}

async function eventStatus(
  request: import("@playwright/test").APIRequestContext,
  eventId: string,
) {
  const res = await request.get(
    `${apiBase()}/api/internal/events/status?eventId=${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
  );
  return (await res.json()) as { processingStatus?: string; attemptCount?: number };
}

test("an unprocessable event retries, dead-letters, and can be retried by an admin", async ({
  page,
  request,
}) => {
  test.slow();
  const eventId = `evt_dl_${run}_${randomUUID().slice(0, 8)}`;

  // Accepted at the boundary (the signature is valid) but not projectable.
  expect((await postUnprojectableEvent(request, eventId)).status()).toBe(202);

  // The sweep escalates it through FAILED to DEAD_LETTER, never beyond the
  // attempt ceiling.
  let status = await eventStatus(request, eventId);
  for (let i = 0; i < 8 && status.processingStatus !== "DEAD_LETTER"; i++) {
    await request.get(`${apiBase()}/api/internal/events/retry`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    status = await eventStatus(request, eventId);
  }
  expect(status.processingStatus).toBe("DEAD_LETTER");

  // The sweep must NOT resurrect it on its own.
  await request.get(`${apiBase()}/api/internal/events/retry`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect((await eventStatus(request, eventId)).processingStatus).toBe("DEAD_LETTER");

  // An administrator can retry it explicitly from the integration screen,
  // which resets the counter and re-runs processing.
  const { email, password } = adminCredentials();
  await login(page, email, password);
  await page.goto("/integrations/pronatona");
  const row = page.locator("tr", { hasText: eventId });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("DEAD_LETTER", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Retry" }).click();

  // It fails again (the lead still does not exist) but the attempt counter was
  // reset, proving the admin retry actually re-entered processing.
  await expect(async () => {
    const after = await eventStatus(request, eventId);
    expect(after.attemptCount).toBeLessThan(status.attemptCount ?? 99);
  }).toPass({ timeout: 30_000 });
});

test("sign-out ends the session on the real host", async ({ page }) => {
  const { email, password } = adminCredentials();
  await login(page, email, password);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");

  // The cockpit is no longer reachable with the discarded session.
  await page.goto("/dashboard");
  await page.waitForURL("**/login");
});

test("an administrator can revoke another member's sessions immediately", async ({
  browser,
  page,
}) => {
  const operator = operatorCredentials();

  // The operator signs in and holds a live session.
  const operatorContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  await login(operatorPage, operator.email, operator.password);
  await expect(
    operatorPage.getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible();

  // An administrator revokes their sessions…
  const { email, password } = adminCredentials();
  await login(page, email, password);
  await page.goto("/settings/users");
  const operatorRow = page.locator("tr", { hasText: operator.email });
  await expect(operatorRow).toHaveCount(1);
  await operatorRow.getByRole("button", { name: "Revoke sessions" }).click();
  // The click returns before the server action commits; wait for the action
  // and its revalidation to settle before asserting on the other session.
  await page.waitForLoadState("networkidle");

  // …and the operator's existing session stops working on their next request,
  // with no sign-out on their side. Retried briefly so the assertion measures
  // "takes effect without re-authenticating", not action round-trip latency.
  await expect(async () => {
    await operatorPage.goto("/dashboard");
    expect(new URL(operatorPage.url()).pathname).toBe("/login");
  }).toPass({ timeout: 20_000 });
  await operatorContext.close();
});
