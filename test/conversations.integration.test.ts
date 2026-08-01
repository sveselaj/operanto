import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conversations foundation, exercised against a real PostgreSQL database.
 *
 * Tenant isolation and privacy are query-shaped guarantees — a `where` clause
 * that forgets `organisationId`, a redaction that misses a column. A mocked
 * Prisma client would return whatever the mock was told and prove nothing, so
 * the database has to be real. Skipped unless TEST_DATABASE_URL points at a
 * disposable database: every case truncates the shared tables.
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
  addConversationNote,
  addManualMessage,
  assignConversation,
  changeConversationPriority,
  changeConversationStatus,
  createManualConversation,
  getConversation,
  linkConversationCustomer,
  listConversations,
  unlinkConversationCustomer,
} = await import("@/lib/services/conversations");
const { ingestSimulatedMessage, SIMULATOR_SCENARIOS } = await import(
  "@/lib/services/conversation-simulator"
);
const { eraseCustomer, redactExpiredMessages } = await import(
  "@/lib/services/privacy"
);

async function makeCtx(slug: string, role: "ADMIN" | "SUPERVISOR" | "OPERATOR" = "ADMIN") {
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
    data: {
      organisationId: organisation.id,
      userId: user.id,
      role,
      status: "ACTIVE",
    },
  });
  return {
    organisation,
    membership,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

async function makeCustomer(
  organisationId: string,
  data: { name: string; email?: string; restrictedAt?: Date; erasedAt?: Date } = {
    name: "Test Customer",
  },
) {
  return db.customer.create({
    data: {
      organisationId,
      name: data.name,
      email: data.email ?? null,
      emailNormalized: data.email ? data.email.trim().toLowerCase() : null,
      restrictedAt: data.restrictedAt ?? null,
      erasedAt: data.erasedAt ?? null,
    },
  });
}

beforeEach(async () => {
  // Order matters only for readability — TRUNCATE ... CASCADE clears children.
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Organisation", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describeDb("manual conversations", () => {
  it("creates a conversation with participant, activity, and audit trail", async () => {
    const ctx = await makeCtx("org-a");
    const conversation = await createManualConversation(ctx, {
      counterpartName: "Walk-in visitor",
      subject: "Showroom question",
      priority: "HIGH",
      initialMessage: "Visitor asked about opening hours.",
    });

    const loaded = await getConversation(ctx, conversation.id);
    expect(loaded?.subject).toBe("Showroom question");
    expect(loaded?.priority).toBe("HIGH");
    expect(loaded?.channelType).toBe("MANUAL");
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0]?.direction).toBe("OUTBOUND");
    expect(loaded?.messages[0]?.deliveryStatus).toBe("RECORDED");
    expect(
      loaded?.participants.some(
        (p) => p.type === "CUSTOMER" && p.displayName === "Walk-in visitor",
      ),
    ).toBe(true);

    const activities = await db.activity.findMany({
      where: { conversationId: conversation.id },
    });
    expect(activities.map((a) => a.activityType)).toContain("conversation.created");

    const audits = await db.auditEvent.findMany({
      where: { targetId: conversation.id, eventType: "conversation.created" },
    });
    expect(audits).toHaveLength(1);
    // PII minimisation: no message content or names in audit metadata.
    expect(JSON.stringify(audits[0]!.afterMetadata)).not.toContain("Walk-in");
    expect(JSON.stringify(audits[0]!.afterMetadata)).not.toContain("opening hours");
  });

  it("supports the full manage cycle: note, status, priority, assign", async () => {
    const ctx = await makeCtx("org-a");
    const conversation = await createManualConversation(ctx, {
      counterpartName: "Caller",
    });

    await addConversationNote(ctx, conversation.id, "Buyer wants two bedrooms.");
    await changeConversationStatus(ctx, conversation.id, "PENDING");
    await changeConversationPriority(ctx, conversation.id, "URGENT");
    await assignConversation(ctx, conversation.id, ctx.membership.id);

    const loaded = await getConversation(ctx, conversation.id);
    expect(loaded?.status).toBe("PENDING");
    expect(loaded?.priority).toBe("URGENT");
    expect(loaded?.assignedMembershipId).toBe(ctx.membership.id);
    expect(loaded?.notes[0]?.body).toBe("Buyer wants two bedrooms.");

    const auditTypes = (
      await db.auditEvent.findMany({ where: { targetId: conversation.id } })
    ).map((a) => a.eventType);
    expect(auditTypes).toEqual(
      expect.arrayContaining([
        "conversation.note_added",
        "conversation.status_changed",
        "conversation.priority_changed",
        "conversation.assigned",
      ]),
    );
  });

  it("blocks new messages when the customer's processing is restricted", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await makeCustomer(ctx.organisation.id, {
      name: "Restricted person",
      restrictedAt: new Date(),
    });
    const conversation = await createManualConversation(ctx, {
      customerId: customer.id,
    });
    await expect(
      addManualMessage(ctx, conversation.id, "should not be recorded"),
    ).rejects.toThrow(/restricted/);
    expect(await db.message.count()).toBe(0);
  });

  it("refuses to link an erased customer", async () => {
    const ctx = await makeCtx("org-a");
    const erased = await makeCustomer(ctx.organisation.id, {
      name: "[erased]",
      erasedAt: new Date(),
    });
    const conversation = await createManualConversation(ctx, {
      counterpartName: "Someone",
    });
    await expect(
      linkConversationCustomer(ctx, conversation.id, erased.id),
    ).rejects.toThrow(/erased/);
  });
});

describeDb("tenant isolation", () => {
  it("never lists, reads, or mutates another organisation's conversations", async () => {
    const ctxA = await makeCtx("org-a");
    const ctxB = await makeCtx("org-b");
    const conversation = await createManualConversation(ctxA, {
      counterpartName: "Org A visitor",
      subject: "Org A private subject",
    });

    const listB = await listConversations(ctxB);
    expect(listB.conversations).toHaveLength(0);
    expect(await getConversation(ctxB, conversation.id)).toBeNull();
    await expect(
      changeConversationStatus(ctxB, conversation.id, "RESOLVED"),
    ).rejects.toThrow("Conversation not found");
    await expect(
      addConversationNote(ctxB, conversation.id, "cross-tenant note"),
    ).rejects.toThrow("Conversation not found");
    await expect(
      addManualMessage(ctxB, conversation.id, "cross-tenant message"),
    ).rejects.toThrow("Conversation not found");
  });

  it("rejects assignment to a membership of another organisation", async () => {
    const ctxA = await makeCtx("org-a");
    const ctxB = await makeCtx("org-b");
    const conversation = await createManualConversation(ctxA, {
      counterpartName: "Visitor",
    });
    await expect(
      assignConversation(ctxA, conversation.id, ctxB.membership.id),
    ).rejects.toThrow(/not an active member/);
  });

  it("rejects linking a customer from another organisation", async () => {
    const ctxA = await makeCtx("org-a");
    const ctxB = await makeCtx("org-b");
    const foreignCustomer = await makeCustomer(ctxB.organisation.id, {
      name: "Org B customer",
    });
    const conversation = await createManualConversation(ctxA, {
      counterpartName: "Visitor",
    });
    await expect(
      linkConversationCustomer(ctxA, conversation.id, foreignCustomer.id),
    ).rejects.toThrow("Customer not found in this organisation");
  });

  it("operators see only conversations they are assigned or created", async () => {
    const admin = await makeCtx("org-a", "ADMIN");
    const operator = await makeCtx("org-a", "OPERATOR");

    const foreign = await createManualConversation(admin, {
      counterpartName: "Admin-only case",
    });
    const assigned = await createManualConversation(admin, {
      counterpartName: "Operator case",
      assignedMembershipId: operator.membership.id,
    });
    const own = await createManualConversation(operator, {
      counterpartName: "Operator-created case",
    });

    const listed = await listConversations(operator);
    const ids = listed.conversations.map((c) => c.id);
    expect(ids).toContain(assigned.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
    expect(await getConversation(operator, foreign.id)).toBeNull();
  });
});

describeDb("simulator ingestion", () => {
  it("is deterministic and idempotent, and links by exact e-mail only", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await makeCustomer(ctx.organisation.id, {
      name: "Nagelista Shopper",
      email: SIMULATOR_SCENARIOS.nagelista.linkEmail,
    });

    const first = await ingestSimulatedMessage(ctx.organisation.id, "nagelista");
    expect(first.duplicate).toBe(false);
    expect(first.customerId).toBe(customer.id);

    const replay = await ingestSimulatedMessage(ctx.organisation.id, "nagelista");
    expect(replay.duplicate).toBe(true);
    expect(replay.conversationId).toBe(first.conversationId);
    expect(await db.message.count()).toBe(1);

    const loaded = await getConversation(ctx, first.conversationId);
    expect(loaded?.channelType).toBe("SIMULATOR");
    expect(loaded?.messages[0]?.direction).toBe("INBOUND");
    expect(loaded?.messages[0]?.senderType).toBe("CUSTOMER");

    const audits = await db.auditEvent.findMany({
      where: { eventType: "conversation.inbound_received" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.afterMetadata)).not.toContain("nail set");
  });

  it("creates an unlinked conversation when no exact match exists, and never re-links an erased tombstone", async () => {
    const ctx = await makeCtx("org-a");
    await makeCustomer(ctx.organisation.id, {
      name: "[erased]",
      email: SIMULATOR_SCENARIOS.pronatona.linkEmail,
      erasedAt: new Date(),
    });
    const result = await ingestSimulatedMessage(ctx.organisation.id, "pronatona");
    expect(result.customerId).toBeNull();
    const loaded = await getConversation(ctx, result.conversationId);
    expect(loaded?.participants[0]?.displayName).toBe(
      SIMULATOR_SCENARIOS.pronatona.senderDisplayName,
    );
  });

  it("keeps simulator data inside the target organisation", async () => {
    const ctxA = await makeCtx("org-a");
    const ctxB = await makeCtx("org-b");
    const result = await ingestSimulatedMessage(ctxA.organisation.id, "nagelista");
    expect(await getConversation(ctxB, result.conversationId)).toBeNull();
    expect((await listConversations(ctxB)).conversations).toHaveLength(0);
  });
});

describeDb("privacy lifecycle", () => {
  it("erasure redacts subjects, messages, notes, participants, and activities", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await makeCustomer(ctx.organisation.id, {
      name: "Blerta Hoxha",
      email: SIMULATOR_SCENARIOS.nagelista.linkEmail,
    });
    await ingestSimulatedMessage(ctx.organisation.id, "nagelista");
    const conversation = (await listConversations(ctx)).conversations[0]!;
    await addManualMessage(ctx, conversation.id, "Reply quoting Blerta Hoxha's order");
    await addConversationNote(ctx, conversation.id, "Blerta prefers pickup in Prishtina");

    await eraseCustomer(ctx, customer.id, "Art. 17 request");

    const strings = JSON.stringify([
      await db.conversation.findMany(),
      await db.message.findMany(),
      await db.conversationNote.findMany(),
      await db.conversationParticipant.findMany(),
      await db.activity.findMany(),
    ]);
    expect(strings).not.toContain("Blerta");
    expect(strings).not.toContain("nail set");
    expect(strings).not.toContain("pickup in Prishtina");

    const messages = await db.message.findMany();
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.body).toBe("[erased]");
      expect(message.redactedAt).not.toBeNull();
    }

    // Erasure remains provable, with counts and no content.
    const audits = await db.auditEvent.findMany({
      where: { eventType: "privacy.customer_erased" },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0]!.afterMetadata as Record<string, unknown>;
    expect(meta.conversationsRedacted).toBe(1);
    expect(Number(meta.messagesRedacted)).toBeGreaterThanOrEqual(2);

    // The tombstone is never re-matched: a replayed scenario stays unlinked.
    await db.message.deleteMany();
    await db.conversation.deleteMany();
    const relinked = await ingestSimulatedMessage(ctx.organisation.id, "nagelista");
    expect(relinked.customerId).toBeNull();
  });

  it("retention redacts only messages older than the per-organisation window", async () => {
    const ctxShort = await makeCtx("org-short");
    const ctxLong = await makeCtx("org-long");
    await db.organisation.update({
      where: { id: ctxShort.organisation.id },
      data: { messageRetentionDays: 30 },
    });

    const short = await createManualConversation(ctxShort, {
      counterpartName: "Old case",
      initialMessage: "short-org message",
    });
    const long = await createManualConversation(ctxLong, {
      counterpartName: "Old case",
      initialMessage: "long-org message",
    });
    // Age both messages far beyond 30 days but inside the 365-day default.
    const old = new Date(Date.now() - 90 * 86_400_000);
    await db.message.updateMany({ data: { createdAt: old } });

    const result = await redactExpiredMessages();
    expect(result.redacted).toBe(1);

    const shortMessages = await db.message.findMany({
      where: { conversationId: short.id },
    });
    expect(shortMessages[0]!.body).toBe("[expired]");
    expect(shortMessages[0]!.redactedAt).not.toBeNull();

    const longMessages = await db.message.findMany({
      where: { conversationId: long.id },
    });
    expect(longMessages[0]!.body).toBe("long-org message");
    expect(longMessages[0]!.redactedAt).toBeNull();
  });

  it("unlinking never copies the customer's name onto the conversation", async () => {
    const ctx = await makeCtx("org-a");
    const customer = await makeCustomer(ctx.organisation.id, {
      name: "Fatmir Gashi",
    });
    const conversation = await createManualConversation(ctx, {
      customerId: customer.id,
    });
    await unlinkConversationCustomer(ctx, conversation.id);
    const participants = await db.conversationParticipant.findMany({
      where: { conversationId: conversation.id, type: "CUSTOMER" },
    });
    expect(participants).toHaveLength(1);
    expect(JSON.stringify(participants)).not.toContain("Fatmir");
  });
});
