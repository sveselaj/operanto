import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

export const EVENTS_PATH = "/api/v1/integrations/pronatona/events";

export function webhookSecret(): string {
  const secret = process.env.PRONATONA_WEBHOOK_SECRET;
  if (!secret) throw new Error("PRONATONA_WEBHOOK_SECRET missing in env");
  return secret;
}

export function sourceOrganisationId(): string {
  return process.env.PRONATONA_SOURCE_ORGANISATION_ID ?? "org_pronatona";
}

export type LeadEventInput = {
  leadId: string;
  customerName: string;
  customerEmail: string;
  message?: string;
  propertyReference?: string;
};

export function buildLeadCreatedEnvelope(input: LeadEventInput) {
  return {
    eventId: `evt_${randomUUID()}`,
    eventType: "lead.created",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "PRONATONA_WEB",
    organisationId: sourceOrganisationId(),
    correlationId: input.leadId,
    actor: { type: "CUSTOMER", userId: null, membershipId: null },
    data: {
      leadId: input.leadId,
      inquiryType: "PROPERTY_QUESTION",
      sourceChannel: "website",
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        phone: null,
        preferredLanguage: "sq",
        preferredChannel: "EMAIL",
      },
      message: input.message ?? "E2E acceptance inquiry — please respond.",
      propertyId: `prop_${input.leadId}`,
      propertyReference: input.propertyReference ?? "PRN-E2E-001",
      assignedAgentId: null,
      property: {
        id: `prop_${input.leadId}`,
        referenceCode: input.propertyReference ?? "PRN-E2E-001",
        title: "E2E Test Property",
        status: "ACTIVE",
        price: 100000,
        currency: "EUR",
        city: "Prishtinë",
        publicUrl: "https://pronatona.com/sq/prona/e2e-test-property",
        thumbnailUrl: null,
      },
    },
  };
}

export async function postSignedEvent(
  request: APIRequestContext,
  envelope: Record<string, unknown>,
  options: { secret?: string; timestampOffsetSeconds?: number } = {},
) {
  const rawBody = JSON.stringify(envelope);
  const timestamp = String(
    Math.floor(Date.now() / 1000) + (options.timestampOffsetSeconds ?? 0),
  );
  const signature = createHmac("sha256", options.secret ?? webhookSecret())
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return request.post(EVENTS_PATH, {
    headers: {
      "Content-Type": "application/json",
      "X-Operanto-Event-Id": String(envelope.eventId),
      "X-Operanto-Timestamp": timestamp,
      "X-Operanto-Signature": signature,
    },
    data: rawBody,
  });
}

/**
 * Drive event processing to completion through the REAL retry path: the
 * CRON-protected sweep (the same mechanism staging uses), then poll the worker
 * health endpoint until nothing is pending. Requires the server to run with
 * OPERANTO_STALE_EVENT_MINUTES=0 so fresh events are immediately sweepable.
 */
export async function processPendingEvents(request: APIRequestContext) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET missing in env");
  const auth = { Authorization: `Bearer ${cronSecret}` };

  for (let attempt = 0; attempt < 15; attempt++) {
    await request.post("/api/internal/events/retry", { headers: auth });
    const health = await request.get("/api/health/worker", { headers: auth });
    if (health.ok()) {
      const body = (await health.json()) as { pending: number; retryable: number };
      if (body.pending === 0 && body.retryable === 0) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("events still pending after retry sweeps");
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

export function adminCredentials() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("SEED_ADMIN_* missing in env");
  return { email, password };
}

export const OPERATOR = {
  email: "operator@operanto.local",
  password: "operator-test-Passw0rd1",
};

export const FOREIGN_ADMIN = {
  email: "admin@isolation-test.local",
  password: "isolation-test-Admin1-long",
};
