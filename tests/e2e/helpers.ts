import { createHmac, randomUUID } from "node:crypto";
import { generateTotp } from "../../src/lib/totp";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

export const EVENTS_PATH = "/api/v1/integrations/pronatona/events";

/**
 * The ingestion and scheduler surfaces live on the API host, which is a
 * different origin from the cockpit in deployed environments. Locally a single
 * origin serves everything, so this falls back to the page base URL.
 */
export function apiBase(): string {
  return (
    process.env.PLAYWRIGHT_API_BASE_URL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    "http://localhost:3000"
  );
}

function apiUrl(path: string): string {
  return `${apiBase().replace(/\/$/, "")}${path}`;
}

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
  return request.post(apiUrl(EVENTS_PATH), {
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
 * Wait until a specific event reaches PROCESSED, driving the REAL retry sweep
 * on the way (the same CRON-protected mechanism staging uses).
 *
 * Deliberately per-event rather than "global health is green": unrelated
 * dead-lettered rows left by other tests must not make every later run fail,
 * and a green global count must not be mistaken for "my event worked".
 */
export async function waitForEventProcessed(
  request: APIRequestContext,
  eventId: string,
) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET missing in env");
  const auth = { Authorization: `Bearer ${cronSecret}` };

  let lastStatus = "unknown";
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await request.get(
      apiUrl(`/api/internal/events/status?eventId=${encodeURIComponent(eventId)}`),
      { headers: auth },
    );
    if (res.ok()) {
      const body = (await res.json()) as {
        found: boolean;
        processingStatus?: string;
      };
      lastStatus = body.processingStatus ?? "absent";
      if (body.processingStatus === "PROCESSED") return;
      if (body.processingStatus === "DEAD_LETTER") {
        throw new Error(`event ${eventId} dead-lettered`);
      }
    }
    // Nudge the real sweep, then wait before re-checking.
    await request.post(apiUrl("/api/internal/events/retry"), { headers: auth });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`event ${eventId} not processed (last status: ${lastStatus})`);
}

/** Aggregate worker health (used to assert the sweep endpoint itself works). */
export async function workerHealth(request: APIRequestContext) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET missing in env");
  const res = await request.get(apiUrl("/api/health/worker"), {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  return (await res.json()) as {
    ok: boolean;
    pending: number;
    retryable: number;
    deadLetter: number;
  };
}

/**
 * Counters already spent in this process. The server refuses a TOTP counter
 * twice (replay protection), so a second sign-in inside the same 30 s window
 * must present a recovery code instead of the same code again.
 */
const spentCounters = new Set<number>();
let recoveryCodeIndex = 0;

/** Fixture recovery codes are deterministic — see prisma/seed.ts. */
function nextRecoveryCode(): string {
  return `TEST${String(recoveryCodeIndex++).padStart(5, "0")}`;
}

function secondFactorFor(): string {
  const secret = process.env.SEED_TEST_TOTP_SECRET;
  if (!secret) throw new Error("SEED_TEST_TOTP_SECRET missing in env");
  const counter = Math.floor(Date.now() / 1000 / 30);
  if (spentCounters.has(counter)) return nextRecoveryCode();
  spentCounters.add(counter);
  return generateTotp(secret);
}

/**
 * Session cookies from the last successful sign-in, keyed by account.
 *
 * The suite signs in roughly ten times, and with a mandatory second factor each
 * sign-in is TWO submissions against a limit of ten per account per fifteen
 * minutes — so a full run locks itself out partway through. Reusing the session
 * keeps the run under the limit without weakening the limit itself, which is a
 * real control and not something a test should be allowed to soften.
 *
 * Self-healing: a cached cookie that no longer works (the sign-out and
 * session-revocation tests deliberately kill it) simply falls through to a real
 * sign-in, so no test is silently skipped.
 */
type SessionCookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessionCache = new Map<string, SessionCookies>();

/**
 * Sign in, completing the second factor when the account has one. Accounts
 * that do not require 2FA (OPERATOR) never see the prompt.
 *
 * Pass `{ fresh: true }` when the test is *about* signing in and must exercise
 * the real form rather than a restored session.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  options: { fresh?: boolean } = {},
) {
  const cached = options.fresh ? undefined : sessionCache.get(email);
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto("/dashboard");
    if (page.url().includes("/dashboard")) return;
    sessionCache.delete(email);
    await page.context().clearCookies();
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const tokenField = page.getByLabel("Authentication code");
  await Promise.race([
    page.waitForURL("**/dashboard").catch(() => undefined),
    tokenField.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined),
  ]);

  if (await tokenField.isVisible().catch(() => false)) {
    await tokenField.fill(secondFactorFor());
    await page.getByRole("button", { name: "Sign in" }).click();

    // The per-process spent-counter set cannot see codes another process
    // consumed: two suite invocations inside the same 30 s TOTP window mint
    // the same code, and the server's replay guard rightly refuses the second
    // one. Waiting out the window and submitting the next code always
    // succeeds, because the counter is strictly increasing.
    const rejection = page
      .getByRole("alert")
      .filter({ hasText: /code is not valid/i });
    const outcome = await Promise.race([
      page.waitForURL("**/dashboard", { timeout: 15_000 }).then(
        () => "ok" as const,
        () => "pending" as const,
      ),
      rejection.waitFor({ state: "visible", timeout: 15_000 }).then(
        () => "rejected" as const,
        () => "pending" as const,
      ),
    ]);
    if (outcome === "rejected") {
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      await tokenField.fill(secondFactorFor());
      await page.getByRole("button", { name: "Sign in" }).click();
    }
  }
  await page.waitForURL("**/dashboard");
  sessionCache.set(email, await page.context().cookies());
}

export function adminCredentials() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("SEED_ADMIN_* missing in env");
  return { email, password };
}

/**
 * Fixture credentials come from the environment — the same variables the seed
 * requires. Nothing here is a hardcoded, committed password.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing in env (required for e2e)`);
  return value;
}

export function operatorCredentials() {
  return {
    email: "operator@operanto.local",
    password: requiredEnv("SEED_TEST_OPERATOR_PASSWORD"),
  };
}

export const FOREIGN_ADMIN = {
  email: "admin@isolation-test.local",
  password: () => requiredEnv("SEED_TEST_ISOLATION_ADMIN_PASSWORD"),
};
