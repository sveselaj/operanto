import { describe, it, expect, vi, beforeEach } from "vitest";

// Prisma mock — one fn per method the pipeline touches. `vi.hoisted` so these
// are initialized before the hoisted `vi.mock` factories reference them.
const { db, runAutomations } = vi.hoisted(() => ({
  db: {
    channelAccount: { findUnique: vi.fn() },
    customer: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), findFirst: vi.fn() },
    consent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  runAutomations: vi.fn<(...a: unknown[]) => Promise<number>>(async () => 0),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
// Automations run as a side effect; assert it fires without exercising its logic.
vi.mock("@/lib/services/automations", () => ({
  runAutomationsForConversation: (...a: unknown[]) => runAutomations(...a),
}));

import { ingestInbound } from "@/lib/services/ingestion";
import type { NormalizedInbound } from "@/lib/channels";

const inbound = (over: Partial<NormalizedInbound> = {}): NormalizedInbound => ({
  channelAccountId: "ch_1",
  body: "How much for a haircut?",
  customer: { handle: "@jane", externalId: "ext_jane" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.channelAccount.findUnique.mockResolvedValue({
    id: "ch_1",
    workspaceId: "ws_1",
    type: "instagram",
  });
  db.customer.create.mockImplementation(async (a: { data: object }) => ({ id: "cust_1", ...a.data }));
  // Identity backfill on an existing match returns the same record.
  db.customer.update.mockImplementation(async (a: { where: { id: string }; data: object }) => ({
    id: a.where.id,
    workspaceId: "ws_1",
    ...a.data,
  }));
  db.conversation.create.mockImplementation(async (a: { data: object }) => ({
    id: "conv_1",
    customerId: "cust_1",
    ...a.data,
  }));
});

describe("ingestInbound", () => {
  it("throws on an unknown channel account", async () => {
    db.channelAccount.findUnique.mockResolvedValueOnce(null);
    await expect(ingestInbound(inbound())).rejects.toThrow(/Unknown channel account/);
  });

  it("creates a new customer + conversation and fires create+inbound triggers", async () => {
    db.customer.findFirst.mockResolvedValue(null);
    db.conversation.findFirst.mockResolvedValue(null);

    const res = await ingestInbound(inbound());

    expect(res).toEqual({ conversationId: "conv_1", customerId: "cust_1", created: true });

    // Customer created scoped to the channel account's workspace, with social handle.
    expect(db.customer.create).toHaveBeenCalledTimes(1);
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: "ws_1",
      socialHandles: { instagram: "@jane", externalId: "ext_jane" },
    });

    expect(db.conversation.create).toHaveBeenCalledTimes(1);
    expect(db.message.create).toHaveBeenCalledTimes(1);
    expect(db.message.create.mock.calls[0][0].data).toMatchObject({
      direction: "inbound",
      senderType: "customer",
      body: "How much for a haircut?",
    });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);

    // New conversation → both triggers fire.
    expect(runAutomations).toHaveBeenCalledTimes(2);
    const triggers = runAutomations.mock.calls.map((c) => c[1]);
    expect(triggers).toEqual(["conversation_created", "inbound_message"]);
  });

  it("reuses an existing customer + open conversation and fires only inbound_message", async () => {
    db.customer.findFirst.mockResolvedValue({ id: "cust_9", workspaceId: "ws_1" });
    db.conversation.findFirst.mockResolvedValue({
      id: "conv_9",
      customerId: "cust_9",
      workspaceId: "ws_1",
    });

    const res = await ingestInbound(inbound({ customer: { email: "jane@x.com" } }));

    expect(res).toEqual({ conversationId: "conv_9", customerId: "cust_9", created: false });
    expect(db.customer.create).not.toHaveBeenCalled();
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(db.message.create).toHaveBeenCalledTimes(1);

    expect(runAutomations).toHaveBeenCalledTimes(1);
    expect(runAutomations.mock.calls[0][1]).toBe("inbound_message");
  });

  it("matches an existing customer by email/phone/externalId only (skips lookup when no identifiers)", async () => {
    db.customer.findFirst.mockResolvedValue(null);
    db.conversation.findFirst.mockResolvedValue(null);

    // No email/phone/externalId → findCustomer returns null without querying.
    await ingestInbound(inbound({ customer: { name: "Anon" } }));
    expect(db.customer.findFirst).not.toHaveBeenCalled();
    expect(db.customer.create).toHaveBeenCalledTimes(1);
  });
});
