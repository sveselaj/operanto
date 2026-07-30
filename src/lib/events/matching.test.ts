import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { findOrCreateCustomer } from "@/lib/events/matching";

/**
 * The matching policy is the safety-critical part of customer continuity:
 * exact identifiers only, first match wins in priority order, gaps are filled
 * but existing identity fields are never overwritten.
 */

const NOW = new Date("2026-07-30T09:30:00.000Z");

function makeTx() {
  const customer = {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    create: vi
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: "cust_new", ...data }),
      ),
  };
  return { customer } as unknown as Prisma.TransactionClient & {
    customer: typeof customer;
  };
}

describe("findOrCreateCustomer", () => {
  let tx: ReturnType<typeof makeTx>;
  beforeEach(() => {
    tx = makeTx();
  });

  it("creates a new customer with normalized keys when nothing matches", async () => {
    const result = await findOrCreateCustomer(
      tx,
      "org_1",
      {
        sourceSystem: "PRONATONA_WEB",
        name: "Arta",
        email: " Arta@Example.com ",
        phone: "+383 44 123 456",
      },
      NOW,
    );
    expect(result).toEqual({
      customerId: "cust_new",
      created: true,
      matchReason: "created_new",
    });
    const created = tx.customer.create.mock.calls[0][0].data;
    expect(created.emailNormalized).toBe("arta@example.com");
    expect(created.phoneNormalized).toBe("+38344123456");
    expect(created.firstInteractionAt).toBe(NOW);
  });

  it("prefers the source customer id over email", async () => {
    tx.customer.findUnique.mockResolvedValue({
      id: "cust_by_source",
      name: "Existing",
      email: "kept@example.com",
      emailNormalized: "kept@example.com",
      phone: null,
      phoneNormalized: null,
      preferredLanguage: null,
      preferredChannel: null,
      firstInteractionAt: null,
    });
    const result = await findOrCreateCustomer(
      tx,
      "org_1",
      {
        sourceSystem: "PRONATONA_WEB",
        sourceCustomerId: "src_1",
        email: "different@example.com",
      },
      NOW,
    );
    expect(result.matchReason).toBe("source_customer_id");
    expect(result.created).toBe(false);
    // email gap-filling must NOT overwrite the existing verified email with
    // the different inbound one
    const update = tx.customer.update.mock.calls[0][0].data;
    expect(update.email).not.toBe("different@example.com");
  });

  it("matches by exact normalized email", async () => {
    tx.customer.findFirst.mockResolvedValueOnce({
      id: "cust_email",
      name: null,
      email: "arta@example.com",
      emailNormalized: "arta@example.com",
      phone: null,
      phoneNormalized: null,
      preferredLanguage: null,
      preferredChannel: null,
      firstInteractionAt: NOW,
    });
    const result = await findOrCreateCustomer(
      tx,
      "org_1",
      { sourceSystem: "PRONATONA_WEB", email: "ARTA@example.com", name: "Arta" },
      NOW,
    );
    expect(result).toMatchObject({
      customerId: "cust_email",
      matchReason: "email_exact",
    });
    // the missing name gap IS filled
    expect(tx.customer.update.mock.calls[0][0].data.name).toBe("Arta");
  });

  it("falls back to exact normalized phone when email is absent", async () => {
    tx.customer.findFirst.mockResolvedValueOnce({
      id: "cust_phone",
      name: "P",
      email: null,
      emailNormalized: null,
      phone: "+38344123456",
      phoneNormalized: "+38344123456",
      preferredLanguage: null,
      preferredChannel: null,
      firstInteractionAt: NOW,
    });
    const result = await findOrCreateCustomer(
      tx,
      "org_1",
      { sourceSystem: "PRONATONA_WEB", phone: "00383 44 123 456" },
      NOW,
    );
    expect(result.matchReason).toBe("phone_exact");
  });

  it("never matches by name alone — a namesake becomes a NEW customer", async () => {
    const result = await findOrCreateCustomer(
      tx,
      "org_1",
      { sourceSystem: "PRONATONA_WEB", name: "Arta Krasniqi" },
      NOW,
    );
    expect(result.created).toBe(true);
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
  });
});
