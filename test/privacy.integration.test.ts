import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Privacy lifecycle, exercised against a real PostgreSQL database.
 *
 * These are integration tests on purpose. Every defect they cover was a defect
 * in a *query* — a `where` clause that excluded rows it should have matched, a
 * column nobody remembered to clear. A mocked Prisma client returns whatever
 * the mock was told to return, so these tests would have passed against the
 * broken code and proved nothing. The database has to be real for the assertion
 * "no personal data remains" to mean anything.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database: they
 * truncate every table between cases.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
// The service imports the shared singleton, which reads DATABASE_URL. Point it
// at the disposable database instead.
vi.mock("@/lib/prisma", () => ({ prisma: db }));

// `@/lib/org-context` reaches into Auth.js and next/headers, neither of which
// exists outside a request. Only `scope` is needed here, and it is one line —
// stubbed rather than mocked away so the tenant filter under test is the real
// one. If `scope` ever stops being `{ organisationId }`, this drifts, so it is
// asserted against the real implementation below.
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({ organisationId: c.organisation.id }),
}));

const { eraseCustomer, redactExpiredPayloads, setProcessingRestriction } =
  await import("@/lib/services/privacy");
const { processInboundEvent } = await import("@/lib/events/process");

const SOURCE = "PRONATONA_WEB";
const SOURCE_ORG = "pronatona-org-1";
const LEAD_ID = "lead_pronatona_9001";
const PERSON = {
  name: "Arta Krasniqi",
  email: "arta.krasniqi@example.com",
  phone: "+38344123456",
  message: "Jam e interesuar për banesën në Prishtinë, më kontaktoni te +38344123456",
};

type Ctx = Awaited<ReturnType<typeof makeCtx>>;
let ctx: Ctx;

async function makeCtx(slug = "test-org") {
  const organisation = await db.organisation.create({
    data: { name: slug, slug },
  });
  const user = await db.user.create({
    data: { email: `${slug}@example.com`, name: "Admin", status: "ACTIVE" },
  });
  const membership = await db.membership.create({
    data: {
      organisationId: organisation.id,
      userId: user.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  return { organisation, membership, user };
}

/** Every string stored anywhere, so "is it gone" is asked of the whole database. */
async function everyStoredString(): Promise<string> {
  const tables = await Promise.all([
    db.customer.findMany(),
    db.opportunity.findMany(),
    db.activity.findMany(),
    db.task.findMany(),
    db.inboundEvent.findMany(),
    db.auditEvent.findMany(),
    db.externalIdentityMapping.findMany(),
  ]);
  return JSON.stringify(tables);
}

/** A customer with the full spread of surfaces that hold personal data. */
async function seedCustomerWithEverything() {
  const integration = await db.integration.create({
    data: {
      organisationId: ctx.organisation.id,
      type: "PRONATONA",
      sourceSystem: SOURCE,
      sourceOrganisationId: SOURCE_ORG,
      webhookSecretEncrypted: "not-a-real-secret",
    },
  });
  const customer = await db.customer.create({
    data: {
      organisationId: ctx.organisation.id,
      sourceSystem: SOURCE,
      sourceCustomerId: LEAD_ID,
      name: PERSON.name,
      email: PERSON.email,
      emailNormalized: PERSON.email,
      phone: PERSON.phone,
      phoneNormalized: PERSON.phone,
    },
  });
  const opportunity = await db.opportunity.create({
    data: {
      organisationId: ctx.organisation.id,
      customerId: customer.id,
      sourceSystem: SOURCE,
      sourceOpportunityId: LEAD_ID,
      type: "GENERAL_INQUIRY",
      inquiryText: PERSON.message,
      summary: `Inquiry from ${PERSON.name}`,
    },
  });
  await db.externalIdentityMapping.create({
    data: {
      organisationId: ctx.organisation.id,
      sourceSystem: SOURCE,
      sourceEntityType: "lead",
      sourceEntityId: LEAD_ID,
      operantoEntityType: "opportunity",
      operantoEntityId: opportunity.id,
    },
  });
  await db.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      customerId: customer.id,
      opportunityId: opportunity.id,
      actorType: "INTEGRATION",
      activityType: "inquiry.received",
      summary: `New inquiry from ${PERSON.name}`,
      metadata: { email: PERSON.email, message: PERSON.message },
    },
  });
  await db.task.create({
    data: {
      organisationId: ctx.organisation.id,
      opportunityId: opportunity.id,
      // Staff-authored: the title is free text, which is why redacting only
      // the description was not enough.
      title: `Call ${PERSON.name} on ${PERSON.phone}`,
      description: PERSON.message,
    },
  });
  await db.auditEvent.create({
    data: {
      organisationId: ctx.organisation.id,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      eventType: "task.created",
      targetType: "Opportunity",
      targetId: opportunity.id,
      correlationId: LEAD_ID,
      afterMetadata: { title: `Call ${PERSON.name} on ${PERSON.phone}` },
    },
  });
  return { integration, customer, opportunity };
}

/**
 * A returning customer only — no opportunity for LEAD_ID.
 *
 * The follow-up-task branch is guarded by "no opportunity already exists for
 * this lead". Seeding one makes the branch unreachable, so a restriction test
 * built on `seedCustomerWithEverything` passes whether or not restriction does
 * anything at all. This seeds the state where the branch actually runs: a known
 * customer, matched by email, whose new inquiry would create work.
 */
async function seedReturningCustomer() {
  const integration = await db.integration.create({
    data: {
      organisationId: ctx.organisation.id,
      type: "PRONATONA",
      sourceSystem: SOURCE,
      sourceOrganisationId: SOURCE_ORG,
      webhookSecretEncrypted: "not-a-real-secret",
    },
  });
  const customer = await db.customer.create({
    data: {
      organisationId: ctx.organisation.id,
      sourceSystem: SOURCE,
      name: PERSON.name,
      email: PERSON.email,
      emailNormalized: PERSON.email,
      phone: PERSON.phone,
      phoneNormalized: PERSON.phone,
    },
  });
  return { integration, customer };
}

async function seedEvent(input: {
  integrationId: string;
  status: "RECEIVED" | "PROCESSED" | "FAILED" | "DEAD_LETTER";
  receivedAt: Date;
  eventId?: string;
  attemptCount?: number;
}) {
  const eventId = input.eventId ?? `evt_${input.status}_${input.receivedAt.getTime()}`;
  return db.inboundEvent.create({
    data: {
      organisationId: ctx.organisation.id,
      integrationId: input.integrationId,
      eventId,
      eventType: "lead.created",
      schemaVersion: 1,
      sourceSystem: SOURCE,
      sourceOrganisationId: SOURCE_ORG,
      processingStatus: input.status,
      attemptCount: input.attemptCount ?? 0,
      receivedAt: input.receivedAt,
      occurredAt: input.receivedAt,
      correlationId: LEAD_ID,
      rawPayload: {
        eventId,
        eventType: "lead.created",
        schemaVersion: 1,
        occurredAt: input.receivedAt.toISOString(),
        source: SOURCE,
        correlationId: LEAD_ID,
        data: {
          leadId: LEAD_ID,
          customer: {
            name: PERSON.name,
            email: PERSON.email,
            phone: PERSON.phone,
          },
          message: PERSON.message,
        },
      },
    },
  });
}

beforeAll(async () => {
  if (!TEST_URL) return;
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  if (!TEST_URL) return;
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "AuditEvent", "Task", "Activity", "OpportunityProperty",
      "Opportunity", "Customer", "ExternalIdentityMapping", "InboundEvent",
      "PropertyContext", "Integration", "Invitation", "Membership", "User",
      "Organisation" RESTART IDENTITY CASCADE
  `);
  ctx = await makeCtx();
});

describeDb("erasure removes personal data from every surface", () => {
  it("leaves no trace of the person anywhere in the database", async () => {
    const { integration, customer } = await seedCustomerWithEverything();
    await seedEvent({
      integrationId: integration.id,
      status: "PROCESSED",
      receivedAt: new Date("2026-07-01T00:00:00Z"),
    });

    await eraseCustomer(ctx, customer.id, "Data subject request #12");

    // The whole point of the feature, asserted directly rather than field by
    // field: a field-by-field assertion only checks the fields you remembered.
    const dump = await everyStoredString();
    for (const secret of [PERSON.name, PERSON.email, PERSON.phone, PERSON.message]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("removes the source lead id, which re-identifies the person", async () => {
    const { customer, opportunity } = await seedCustomerWithEverything();

    await eraseCustomer(ctx, customer.id, "request");

    // The lead id is a live key into Pronatona, where the name and phone still
    // are. Leaving it behind means the tombstone is not actually anonymous.
    expect(await everyStoredString()).not.toContain(LEAD_ID);
    const after = await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(after.sourceOpportunityId).toBeNull();
    expect(await db.externalIdentityMapping.count()).toBe(0);
  });

  it("still redacts events the retention sweep already touched", async () => {
    const { integration, customer } = await seedCustomerWithEverything();
    await seedEvent({
      integrationId: integration.id,
      status: "PROCESSED",
      receivedAt: new Date("2020-01-01T00:00:00Z"),
    });

    // Retention runs first and leaves correlationId in place by design.
    await redactExpiredPayloads();
    expect(await db.inboundEvent.count({ where: { correlationId: LEAD_ID } })).toBe(1);

    // Erasure must not skip that row just because it was already redacted.
    const result = await eraseCustomer(ctx, customer.id, "request");
    expect(result.events).toBe(1);
    expect(await db.inboundEvent.count({ where: { correlationId: LEAD_ID } })).toBe(0);
  });

  it("keeps the audit trail while clearing personal values from it", async () => {
    const { customer } = await seedCustomerWithEverything();

    await eraseCustomer(ctx, customer.id, "request");

    // Proof the request was honoured must survive; the values must not.
    const audits = await db.auditEvent.findMany();
    expect(audits.some((a) => a.eventType === "task.created")).toBe(true);
    expect(audits.some((a) => a.eventType === "privacy.customer_erased")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(PERSON.name);
  });

  it("refuses a second erasure rather than writing a misleading audit entry", async () => {
    const { customer } = await seedCustomerWithEverything();
    await eraseCustomer(ctx, customer.id, "request");
    await expect(eraseCustomer(ctx, customer.id, "again")).rejects.toThrow(/already/i);
  });

  it("is refused for a role without privacy:manage", async () => {
    const { customer } = await seedCustomerWithEverything();
    const operator: Ctx = {
      ...ctx,
      membership: { ...ctx.membership, role: "OPERATOR" },
    };
    await expect(eraseCustomer(operator, customer.id, "request")).rejects.toThrow();
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.name).toBe(PERSON.name);
  });

  it("does not reach into another organisation", async () => {
    const { customer } = await seedCustomerWithEverything();
    const other = await makeCtx("other-org");
    await expect(eraseCustomer(other, customer.id, "request")).rejects.toThrow(/not found/i);
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.erasedAt).toBeNull();
  });
});

describeDb("retention sweep", () => {
  it("redacts a dead-lettered payload — nothing else ever will", async () => {
    const { integration } = await seedCustomerWithEverything();
    const event = await seedEvent({
      integrationId: integration.id,
      status: "DEAD_LETTER",
      receivedAt: new Date("2020-01-01T00:00:00Z"),
      attemptCount: 5,
    });

    // A dead-lettered event produced no customer, so erasure cannot reach it.
    // If retention skips it too, the payload is immortal.
    await redactExpiredPayloads();

    const after = await db.inboundEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(JSON.stringify(after.rawPayload)).not.toContain(PERSON.email);
    expect(after.payloadRedactedAt).not.toBeNull();
  });

  it("leaves payloads inside the retention window alone", async () => {
    const { integration } = await seedCustomerWithEverything();
    const event = await seedEvent({
      integrationId: integration.id,
      status: "FAILED",
      receivedAt: new Date(),
    });

    await redactExpiredPayloads();

    // The window is the debugging budget; cutting it short defeats the purpose.
    const after = await db.inboundEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(JSON.stringify(after.rawPayload)).toContain(PERSON.email);
    expect(after.payloadRedactedAt).toBeNull();
  });

  it("keeps the envelope so a redacted event is still diagnosable", async () => {
    const { integration } = await seedCustomerWithEverything();
    const event = await seedEvent({
      integrationId: integration.id,
      status: "DEAD_LETTER",
      receivedAt: new Date("2020-01-01T00:00:00Z"),
    });

    await redactExpiredPayloads();

    const after = await db.inboundEvent.findUniqueOrThrow({ where: { id: event.id } });
    const payload = after.rawPayload as Record<string, unknown>;
    expect(payload.eventType).toBe("lead.created");
    expect(payload.redacted).toBe(true);
  });

  it("refuses to replay a redacted event", async () => {
    const { integration } = await seedCustomerWithEverything();
    const event = await seedEvent({
      integrationId: integration.id,
      status: "FAILED",
      receivedAt: new Date("2020-01-01T00:00:00Z"),
      attemptCount: 1,
    });
    await redactExpiredPayloads();

    // Retention now redacts by age regardless of status, so the retry path has
    // to refuse the husk — otherwise it projects a customer built from nulls.
    expect(await processInboundEvent(event.id)).toBe("not_claimed");
  });
});

describeDb("restriction of processing", () => {
  it("suppresses new follow-up work instead of only showing a banner", async () => {
    const { integration, customer } = await seedReturningCustomer();
    await setProcessingRestriction(ctx, customer.id, true);

    const event = await seedEvent({
      integrationId: integration.id,
      status: "RECEIVED",
      receivedAt: new Date(),
      eventId: "evt_after_restriction",
    });
    expect(await processInboundEvent(event.id)).toBe("processed");

    // Art. 18 means stop acting on the data. A flag that still creates a task
    // telling someone to phone them is not a restriction.
    expect(await db.task.count()).toBe(0);
    expect(
      await db.activity.count({ where: { activityType: "processing.restricted_skip" } }),
    ).toBe(1);
  });

  it("records the event anyway, so history is not lost", async () => {
    const { integration, customer } = await seedReturningCustomer();
    await setProcessingRestriction(ctx, customer.id, true);

    const event = await seedEvent({
      integrationId: integration.id,
      status: "RECEIVED",
      receivedAt: new Date(),
      eventId: "evt_recorded",
    });
    await processInboundEvent(event.id);

    // Suppressing the record itself would lose history and break idempotency.
    const after = await db.inboundEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.processingStatus).toBe("PROCESSED");
    expect(await db.opportunity.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("creates follow-up work when the customer is NOT restricted", async () => {
    // The control for the test above: same seed, same event, no restriction.
    // Without this, "0 tasks" proves nothing — the branch might be unreachable.
    const { integration } = await seedReturningCustomer();

    const event = await seedEvent({
      integrationId: integration.id,
      status: "RECEIVED",
      receivedAt: new Date(),
      eventId: "evt_unrestricted",
    });
    await processInboundEvent(event.id);

    expect(await db.task.count()).toBe(1);
  });

  it("creates follow-up work again once restriction is lifted", async () => {
    const { integration, customer } = await seedReturningCustomer();
    await setProcessingRestriction(ctx, customer.id, true);
    await setProcessingRestriction(ctx, customer.id, false);

    const event = await seedEvent({
      integrationId: integration.id,
      status: "RECEIVED",
      receivedAt: new Date(),
      eventId: "evt_after_resume",
    });
    await processInboundEvent(event.id);

    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.restrictedAt).toBeNull();
    expect(await db.task.count()).toBe(1);
  });
});
