import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WhatsApp Cloud slice against real PostgreSQL. Stage A: inbound through the
 * canonical ChannelInboundEvent pipeline — authoritative phone_number_id
 * routing, dedupe, identity ladder, consent keywords, media metadata,
 * erasure. Stage B: the explicit outbound operation and its recheck chain.
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

process.env.OPERANTO_ENCRYPTION_KEY =
  process.env.OPERANTO_ENCRYPTION_KEY ?? "ab".repeat(32);

const { processChannelInboundEvent, storeChannelPayload } = await import(
  "@/lib/services/channel-ingest"
);
const { linkConversationCustomer } = await import("@/lib/services/conversations");
const { eraseCustomer } = await import("@/lib/services/privacy");
const { connectWhatsApp, setWhatsAppStageGates } = await import(
  "@/lib/services/whatsapp-connection"
);

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

async function waConnection(
  organisationId: string,
  phoneNumberId: string,
  over: Partial<{ inboundEnabled: boolean; outboundEnabled: boolean; status: "ACTIVE" | "DISABLED" }> = {},
) {
  return db.channelConnection.create({
    data: {
      organisationId,
      type: "WHATSAPP",
      displayName: `WhatsApp ${phoneNumberId}`,
      status: over.status ?? "ACTIVE",
      wabaId: `waba-${phoneNumberId}`,
      phoneNumberId,
      displayPhoneNumber: "+355 69 000 000",
      accessTokenEncrypted: null,
      inboundEnabled: over.inboundEnabled ?? true,
      outboundEnabled: over.outboundEnabled ?? false,
    },
  });
}

function waWebhook(
  phoneNumberId: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: `waba-${phoneNumberId}`,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "+355" },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function waText(
  phoneNumberId: string,
  over: Partial<{ from: string; id: string; body: string; name: string }> = {},
) {
  const from = over.from ?? "355691000001";
  const id = over.id ?? `wamid.${Math.random().toString(36).slice(2)}`;
  return waWebhook(phoneNumberId, {
    contacts: [{ wa_id: from, profile: { name: over.name ?? "Wa Sender" } }],
    messages: [
      {
        from,
        id,
        timestamp: `${Math.floor(Date.now() / 1000)}`,
        type: "text",
        text: { body: over.body ?? "Hello via WhatsApp" },
      },
    ],
  });
}

async function ingest(payload: unknown) {
  const stored = await storeChannelPayload("WHATSAPP", payload);
  if (!("eventId" in stored)) throw new Error(`rejected: ${JSON.stringify(stored)}`);
  return processChannelInboundEvent(stored.eventId);
}

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Organisation", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describeDb("whatsapp inbound routing", () => {
  it("routes by the receiving phone_number_id to exactly one tenant", async () => {
    const orgA = await makeCtx("org-a");
    const orgB = await makeCtx("org-b");
    await waConnection(orgA.organisation.id, "pn-a");
    await waConnection(orgB.organisation.id, "pn-b");

    const result = await ingest(waText("pn-b"));
    expect(result.status).toBe("PROCESSED");
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: result.conversationId! },
    });
    expect(conversation.organisationId).toBe(orgB.organisation.id);
    expect(await db.conversation.count({ where: { organisationId: orgA.organisation.id } })).toBe(0);
  });

  it("rejects unknown, disabled, and inbound-gated numbers — no fallback", async () => {
    const ctx = await makeCtx("org-a");
    await waConnection(ctx.organisation.id, "pn-live");
    expect(await storeChannelPayload("WHATSAPP", waText("pn-ghost"))).toMatchObject({
      rejected: "unresolvable_tenant",
    });
    await waConnection(ctx.organisation.id, "pn-off", { inboundEnabled: false });
    expect(await storeChannelPayload("WHATSAPP", waText("pn-off"))).toMatchObject({
      rejected: "unresolvable_tenant",
    });
    await waConnection(ctx.organisation.id, "pn-disabled", { status: "DISABLED" });
    expect(await storeChannelPayload("WHATSAPP", waText("pn-disabled"))).toMatchObject({
      rejected: "unresolvable_tenant",
    });
    expect(await db.channelInboundEvent.count()).toBe(0);
  });

  it("a replayed webhook is a stored-once duplicate; reprocessing is skipped", async () => {
    const ctx = await makeCtx("org-a");
    await waConnection(ctx.organisation.id, "pn-a");
    const payload = waText("pn-a", { id: "wamid.replay-1" });
    const first = await storeChannelPayload("WHATSAPP", payload);
    const replay = await storeChannelPayload("WHATSAPP", payload);
    expect("duplicate" in replay && replay.duplicate).toBe(true);
    await processChannelInboundEvent((first as { eventId: string }).eventId);
    const again = await processChannelInboundEvent((first as { eventId: string }).eventId);
    expect(again.status).toBe("SKIPPED");
    expect(await db.message.count()).toBe(1);
  });
});

describeDb("whatsapp identity and conversations", () => {
  it("unknown sender stays unlinked; same sender reuses the conversation", async () => {
    const ctx = await makeCtx("org-a");
    await waConnection(ctx.organisation.id, "pn-a");
    const first = await ingest(waText("pn-a", { from: "355699111222" }));
    expect(first.customerId).toBeNull();
    const second = await ingest(waText("pn-a", { from: "355699111222", body: "Again" }));
    expect(second.conversationId).toBe(first.conversationId);
    expect(await db.conversation.count()).toBe(1);
    expect(await db.message.count()).toBe(2);
  });

  it("a taught WhatsApp identity links the correct customer on the next message", async () => {
    const ctx = await makeCtx("org-a");
    await waConnection(ctx.organisation.id, "pn-a");
    const customer = await db.customer.create({
      data: { organisationId: ctx.organisation.id, name: "Buyer" },
    });
    const first = await ingest(waText("pn-a", { from: "355697777001" }));
    await linkConversationCustomer(ctx, first.conversationId!, customer.id);
    expect(
      await db.customerIdentity.findFirst({
        where: { customerId: customer.id, externalId: "wa:355697777001" },
      }),
    ).not.toBeNull();

    // A NEW thread from the same wa_id on a second connection would be a new
    // conversation — but the identity ladder still recognises the customer.
    const secondConn = await waConnection(ctx.organisation.id, "pn-a2");
    const second = await ingest(
      waText("pn-a2", { from: "355697777001", body: "New enquiry" }),
    );
    expect(second.customerId).toBe(customer.id);
    expect(second.conversationId).not.toBe(first.conversationId);
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: second.conversationId! },
    });
    expect(conversation.customerId).toBe(customer.id);
    expect(conversation.channelConnectionId).toBe(secondConn.id);
  });

  it("media arrives as safe metadata in a visible media_pending state", async () => {
    const ctx = await makeCtx("org-a");
    await waConnection(ctx.organisation.id, "pn-a");
    const payload = waWebhook("pn-a", {
      contacts: [{ wa_id: "355691000009", profile: { name: "Doc Sender" } }],
      messages: [
        {
          from: "355691000009",
          id: "wamid.media-1",
          timestamp: `${Math.floor(Date.now() / 1000)}`,
          type: "image",
          image: { id: "media-img-1", mime_type: "image/jpeg", caption: "The balcony" },
        },
      ],
    });
    const result = await ingest(payload);
    const message = await db.message.findUniqueOrThrow({ where: { id: result.messageId! } });
    expect(message.body).toBe("The balcony");
    expect(message.metadata).toMatchObject({
      media: { pending: true, kind: "image", providerMediaId: "media-img-1" },
    });
    expect(JSON.stringify(message.metadata)).not.toMatch(/https?:/);
  });
});

describeDb("whatsapp consent", () => {
  it("STOP from a linked WhatsApp sender opts out ONLY that tenant's customer", async () => {
    const orgA = await makeCtx("org-a");
    const orgB = await makeCtx("org-b");
    await waConnection(orgA.organisation.id, "pn-a");
    await waConnection(orgB.organisation.id, "pn-b");
    const customerA = await db.customer.create({
      data: { organisationId: orgA.organisation.id, name: "Shared Number A" },
    });
    const customerB = await db.customer.create({
      data: { organisationId: orgB.organisation.id, name: "Shared Number B" },
    });
    const sameNumber = "355695555000";
    const a = await ingest(waText("pn-a", { from: sameNumber }));
    const b = await ingest(waText("pn-b", { from: sameNumber }));
    await linkConversationCustomer(orgA, a.conversationId!, customerA.id);
    await linkConversationCustomer(orgB, b.conversationId!, customerB.id);

    await ingest(waText("pn-a", { from: sameNumber, body: "STOP" }));
    const consentA = await db.consent.findFirst({
      where: { organisationId: orgA.organisation.id, customerId: customerA.id },
    });
    expect(consentA).toMatchObject({ status: "OPTED_OUT", channelType: "WHATSAPP" });
    expect(
      await db.consent.count({ where: { organisationId: orgB.organisation.id } }),
    ).toBe(0);

    await ingest(waText("pn-a", { from: sameNumber, body: "START" }));
    const rejoined = await db.consent.findFirst({
      where: { organisationId: orgA.organisation.id, customerId: customerA.id },
    });
    expect(rejoined?.status).toBe("OPTED_IN");
  });
});

describeDb("whatsapp privacy", () => {
  it("erasure removes the WhatsApp identity, redacts payloads and messages", async () => {
    const ctx = await makeCtx("org-a");
    await waConnection(ctx.organisation.id, "pn-a");
    const customer = await db.customer.create({
      data: { organisationId: ctx.organisation.id, name: "To Erase" },
    });
    const first = await ingest(
      waText("pn-a", { from: "355698888000", body: "My address is Rruga 5" }),
    );
    await linkConversationCustomer(ctx, first.conversationId!, customer.id);

    await eraseCustomer(ctx, customer.id, "Art. 17 request");

    expect(
      await db.customerIdentity.count({ where: { customerId: customer.id } }),
    ).toBe(0);
    const events = await db.channelInboundEvent.findMany({
      where: { conversationId: first.conversationId },
    });
    for (const event of events) {
      expect(event.payloadRedactedAt).not.toBeNull();
      expect(JSON.stringify(event.rawPayload)).not.toContain("Rruga 5");
    }
    const message = await db.message.findUniqueOrThrow({ where: { id: first.messageId! } });
    expect(message.redactedAt).not.toBeNull();
    expect(message.body).not.toContain("Rruga 5");

    // The tombstoned identity is never re-matched: the same wa_id on a NEW
    // thread must stay unlinked (the old conversation keeps its redacted
    // tombstone anchor by design — redact-in-place, not unlink).
    await waConnection(ctx.organisation.id, "pn-a2");
    const fresh = await ingest(
      waText("pn-a2", { from: "355698888000", body: "Hello again" }),
    );
    expect(fresh.customerId).toBeNull();
    expect(fresh.conversationId).not.toBe(first.conversationId);
  });
});

describeDb("whatsapp connection administration", () => {
  it("encrypts the access token, never stores or returns plaintext", async () => {
    const ctx = await makeCtx("org-a");
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ display_phone_number: "+355" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await connectWhatsApp(ctx, {
      wabaId: "waba-77",
      phoneNumberId: "pn-77",
      displayPhoneNumber: "+355 69 777",
      accessToken: "EAAG-secret-token-value",
    });
    expect(result.verified).toBe(true);
    expect(JSON.stringify(result)).not.toContain("EAAG-secret-token-value");
    const row = await db.channelConnection.findUniqueOrThrow({
      where: { id: result.connectionId },
    });
    expect(row.accessTokenEncrypted).toMatch(/^v1:/);
    expect(row.accessTokenEncrypted).not.toContain("EAAG-secret-token-value");
    expect(row.inboundEnabled).toBe(false);
    expect(row.outboundEnabled).toBe(false);
    const audits = await db.auditEvent.findMany({
      where: { eventType: "channel.connected" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("EAAG-secret-token-value");
  });

  it("refuses to claim a phone number connected to another workspace", async () => {
    const orgA = await makeCtx("org-a");
    const orgB = await makeCtx("org-b");
    await waConnection(orgA.organisation.id, "pn-taken");
    await expect(
      connectWhatsApp(orgB, {
        wabaId: "w",
        phoneNumberId: "pn-taken",
        displayPhoneNumber: "+355",
        accessToken: "t",
      }),
    ).rejects.toThrow(/another workspace/);
  });

  it("stage gates are permission-checked, tenant-scoped and audited", async () => {
    const orgA = await makeCtx("org-a");
    const operator = await makeCtx("org-a", "OPERATOR");
    const foreign = await makeCtx("org-b");
    const connection = await waConnection(orgA.organisation.id, "pn-a", {
      inboundEnabled: false,
    });
    await expect(
      setWhatsAppStageGates(operator, connection.id, { inboundEnabled: true }),
    ).rejects.toThrow(/Missing permission/);
    await expect(
      setWhatsAppStageGates(foreign, connection.id, { inboundEnabled: true }),
    ).rejects.toThrow(/not found/);
    await setWhatsAppStageGates(orgA, connection.id, { inboundEnabled: true });
    const row = await db.channelConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(row.inboundEnabled).toBe(true);
    expect(row.outboundEnabled).toBe(false);
    expect(
      await db.auditEvent.count({ where: { eventType: "channel.stage_gates_updated" } }),
    ).toBe(1);
  });
});
