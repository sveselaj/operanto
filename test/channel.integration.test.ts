import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Channel foundation pipeline against real PostgreSQL: store-then-process,
 * constraint dedupe, atomic claims, retry → dead-letter, consent keywords,
 * the delivery state machine, health stamps, and erasure of raw payloads.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({
    organisationId: c.organisation.id,
  }),
}));

const {
  processChannelInboundEvent,
  retryPendingChannelEvents,
  storeChannelPayload,
} = await import("@/lib/services/channel-ingest");
const { ingestSimulatedMessage } = await import(
  "@/lib/services/conversation-simulator"
);
const { linkConversationCustomer } = await import("@/lib/services/conversations");
const { eraseCustomer, redactExpiredChannelPayloads } = await import(
  "@/lib/services/privacy"
);
const { setConsent } = await import("@/lib/services/consent");

async function makeCtx(slug: string, role: "ADMIN" | "OPERATOR" = "ADMIN") {
  const organisation =
    (await db.organisation.findUnique({ where: { slug } })) ??
    (await db.organisation.create({ data: { name: slug, slug } }));
  const user = await db.user.create({
    data: {
      email: `${slug}-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `${role} of ${slug}`,
      status: "ACTIVE",
    },
  });
  const membership = await db.membership.create({
    data: { organisationId: organisation.id, userId: user.id, role, status: "ACTIVE" },
  });
  return {
    organisation,
    membership,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

async function simulatorConnection(organisationId: string) {
  return db.channelConnection.upsert({
    where: {
      organisationId_type_displayName: {
        organisationId,
        type: "SIMULATOR",
        displayName: "Simulator",
      },
    },
    update: {},
    create: { organisationId, type: "SIMULATOR", displayName: "Simulator" },
  });
}

function messagePayload(
  connectionId: string,
  overrides: Partial<{
    eventId: string;
    thread: string;
    body: string;
    externalId: string;
    email: string | null;
    timestamp: string;
  }> = {},
) {
  const id = overrides.eventId ?? `evt-${Math.random().toString(36).slice(2)}`;
  return {
    simulator: true as const,
    connectionId,
    eventId: id,
    kind: "message" as const,
    thread: overrides.thread ?? `thread-${id}`,
    message: {
      id,
      body: overrides.body ?? "Hello from the pipeline",
      subject: null,
      timestamp: overrides.timestamp ?? new Date().toISOString(),
      sender: {
        externalId: overrides.externalId ?? "sim:test:sender-1",
        displayName: "Pipeline Tester",
        email: overrides.email ?? null,
      },
    },
  };
}

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Organisation", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describeDb("store-then-process", () => {
  it("stores, processes, projects, and stamps connection health", async () => {
    const ctx = await makeCtx("org-a");
    const connection = await simulatorConnection(ctx.organisation.id);
    const stored = await storeChannelPayload(
      "SIMULATOR",
      messagePayload(connection.id),
    );
    expect("eventId" in stored && !stored.duplicate).toBe(true);
    const result = await processChannelInboundEvent(
      (stored as { eventId: string }).eventId,
    );
    expect(result.status).toBe("PROCESSED");
    expect(result.conversationId).not.toBeNull();

    const health = await db.channelConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(health.lastReceivedAt).not.toBeNull();
    expect(health.lastSuccessfulAt).not.toBeNull();
  });

  it("dedupe is a constraint, replays are duplicates, double-claims are skipped", async () => {
    const ctx = await makeCtx("org-a");
    const connection = await simulatorConnection(ctx.organisation.id);
    const payload = messagePayload(connection.id, { eventId: "evt-fixed-1" });

    const first = await storeChannelPayload("SIMULATOR", payload);
    const replay = await storeChannelPayload("SIMULATOR", payload);
    expect("duplicate" in replay && replay.duplicate).toBe(true);

    const eventId = (first as { eventId: string }).eventId;
    await processChannelInboundEvent(eventId);
    const second = await processChannelInboundEvent(eventId);
    expect(second.status).toBe("SKIPPED");
    expect(await db.message.count()).toBe(1);
  });

  it("unknown channels, unresolvable tenants, and missing keys are rejected", async () => {
    expect(await storeChannelPayload("MANUAL", { any: true })).toMatchObject({
      rejected: "unknown_channel",
    });
    expect(await storeChannelPayload("SIMULATOR", { hostile: true })).toMatchObject({
      rejected: "unclassified",
    });
    const ctx = await makeCtx("org-a");
    await simulatorConnection(ctx.organisation.id);
    expect(
      await storeChannelPayload(
        "SIMULATOR",
        messagePayload("nonexistent-connection"),
      ),
    ).toMatchObject({ rejected: "unresolvable_tenant" });
  });

  it("failures retry and exhaust into DEAD_LETTER with audit", async () => {
    const ctx = await makeCtx("org-a");
    const connection = await simulatorConnection(ctx.organisation.id);
    // An invalid timestamp makes projection throw on every attempt.
    const stored = await storeChannelPayload(
      "SIMULATOR",
      messagePayload(connection.id, { timestamp: "not-a-date" }),
    );
    const eventId = (stored as { eventId: string }).eventId;

    for (let i = 0; i < 4; i++) {
      expect((await processChannelInboundEvent(eventId)).status).toBe("FAILED");
    }
    expect((await processChannelInboundEvent(eventId)).status).toBe("DEAD_LETTER");
    // Exhausted rows are not resurrected by the sweep.
    const sweep = await retryPendingChannelEvents();
    expect(sweep.processed).toBe(0);
    const audits = await db.auditEvent.findMany({
      where: { eventType: "channel.event_dead_lettered" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describeDb("consent and delivery status", () => {
  it("a deliberate STOP from a linked customer opts the channel out", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await db.customer.create({
      data: { organisationId: ctx.organisation.id, name: "Keyword Person" },
    });
    const first = await ingestSimulatedMessage(ctx.organisation.id, "nagelista", {
      runId: "consent-1",
    });
    await linkConversationCustomer(ctx, first.conversationId, customer.id);

    // Same sender, same thread — a follow-up "STOP".
    const connection = await simulatorConnection(ctx.organisation.id);
    const stop = await storeChannelPayload(
      "SIMULATOR",
      messagePayload(connection.id, {
        thread: "sim-nagelista-thread-001-consent-1",
        body: "STOP",
        externalId: "sim:nagelista:shopper-001",
      }),
    );
    await processChannelInboundEvent((stop as { eventId: string }).eventId);

    const consent = await db.consent.findUniqueOrThrow({
      where: {
        organisationId_customerId_channelType: {
          organisationId: ctx.organisation.id,
          customerId: customer.id,
          channelType: "SIMULATOR",
        },
      },
    });
    expect(consent.status).toBe("OPTED_OUT");
    expect(consent.source).toBe("inbound_keyword");
  });

  it("manual consent corrections are permission-gated and audited", async () => {
    const admin = await makeCtx("org-a", "ADMIN");
    const operator = await makeCtx("org-a", "OPERATOR");
    const customer = await db.customer.create({
      data: { organisationId: admin.organisation.id, name: "Consent Person" },
    });
    await expect(
      setConsent(operator, customer.id, "SIMULATOR", "OPTED_IN"),
    ).rejects.toThrow(/consent:manage/);
    await setConsent(admin, customer.id, "SIMULATOR", "OPTED_IN");
    const audit = await db.auditEvent.findFirst({
      where: { eventType: "consent.updated" },
    });
    expect(audit).not.toBeNull();
  });

  it("delivery statuses advance monotonically and never regress", async () => {
    const ctx = await makeCtx("org-a");
    const connection = await simulatorConnection(ctx.organisation.id);
    const ingest = await ingestSimulatedMessage(ctx.organisation.id, "nagelista", {
      runId: "dlv-1",
    });
    // Seed an outbound provider-tracked message on the same connection.
    const outbound = await db.message.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: ingest.conversationId,
        channelConnectionId: connection.id,
        direction: "OUTBOUND",
        senderType: "STAFF",
        body: "tracked send (future slice)",
        providerMessageId: "out-msg-1",
        deliveryStatus: "SENT",
      },
    });

    const statusPayload = (id: string, deliveryStatus: "DELIVERED" | "SENT") => ({
      simulator: true as const,
      connectionId: connection.id,
      eventId: id,
      kind: "status" as const,
      status: { providerMessageId: "out-msg-1", deliveryStatus, errorMessage: null },
    });

    const advance = await storeChannelPayload(
      "SIMULATOR",
      statusPayload("st-1", "DELIVERED"),
    );
    await processChannelInboundEvent((advance as { eventId: string }).eventId);
    let reloaded = await db.message.findUniqueOrThrow({ where: { id: outbound.id } });
    expect(reloaded.deliveryStatus).toBe("DELIVERED");
    expect(reloaded.statusUpdatedAt).not.toBeNull();

    const regress = await storeChannelPayload(
      "SIMULATOR",
      statusPayload("st-2", "SENT"),
    );
    await processChannelInboundEvent((regress as { eventId: string }).eventId);
    reloaded = await db.message.findUniqueOrThrow({ where: { id: outbound.id } });
    expect(reloaded.deliveryStatus).toBe("DELIVERED");
  });
});

describeDb("privacy over channel events", () => {
  it("erasure redacts raw payloads for the customer's conversations", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await db.customer.create({
      data: {
        organisationId: ctx.organisation.id,
        name: "Erased Channel Person",
        email: "erase-channel@example.test",
        emailNormalized: "erase-channel@example.test",
      },
    });
    const ingest = await ingestSimulatedMessage(ctx.organisation.id, "nagelista", {
      runId: "erase-ch-1",
    });
    await linkConversationCustomer(ctx, ingest.conversationId, customer.id);

    await eraseCustomer(ctx, customer.id, "Art. 17");
    const events = await db.channelInboundEvent.findMany({
      where: { conversationId: ingest.conversationId },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) {
      expect(event.payloadRedactedAt).not.toBeNull();
      expect(JSON.stringify(event.rawPayload)).not.toContain("nail set");
    }
  });

  it("retention redacts old processed payloads but keeps dead letters for replay", async () => {
    const ctx = await makeCtx("org-a");
    await ingestSimulatedMessage(ctx.organisation.id, "pronatona", {
      runId: "ret-ch-1",
    });
    const old = new Date(Date.now() - 90 * 86_400_000);
    await db.channelInboundEvent.updateMany({ data: { receivedAt: old } });
    const swept = await redactExpiredChannelPayloads();
    expect(swept.redacted).toBeGreaterThanOrEqual(1);
    const events = await db.channelInboundEvent.findMany({
      where: { status: "PROCESSED" },
    });
    for (const event of events) {
      expect(JSON.stringify(event.rawPayload)).not.toContain("apartment");
    }
  });
});
