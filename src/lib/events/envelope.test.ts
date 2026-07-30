import { describe, expect, it } from "vitest";
import {
  eventEnvelopeSchema,
  leadCreatedSchema,
} from "@/lib/events/envelope";

const VALID = {
  eventId: "evt_0d4e0f66",
  eventType: "lead.created",
  schemaVersion: 1,
  occurredAt: "2026-07-30T09:30:00.000Z",
  source: "PRONATONA_WEB",
  organisationId: "org_1",
  correlationId: "lead_1",
  actor: { type: "CUSTOMER", userId: null, membershipId: null },
  data: { leadId: "lead_1" },
};

describe("eventEnvelopeSchema", () => {
  it("accepts the documented envelope", () => {
    expect(eventEnvelopeSchema.safeParse(VALID).success).toBe(true);
  });

  it.each([
    ["eventId", { ...VALID, eventId: "" }],
    ["eventType", { ...VALID, eventType: "" }],
    ["occurredAt", { ...VALID, occurredAt: "yesterday" }],
    ["schemaVersion", { ...VALID, schemaVersion: 0 }],
    ["data", { ...VALID, data: "not-an-object" }],
    ["actor.type", { ...VALID, actor: { type: "ROBOT" } }],
  ])("rejects invalid %s", (_field, input) => {
    expect(eventEnvelopeSchema.safeParse(input).success).toBe(false);
  });

  it("never trusts roles/permissions from the source system (none exist in the contract)", () => {
    const parsed = eventEnvelopeSchema.parse({
      ...VALID,
      // Unknown envelope-level fields are stripped by the strict schema.
      role: "ADMIN",
      permissions: ["*"],
    });
    expect("role" in parsed).toBe(false);
    expect("permissions" in parsed).toBe(false);
  });
});

describe("leadCreatedSchema", () => {
  it("accepts the enriched Pronatona payload and tolerates extra fields", () => {
    const result = leadCreatedSchema.safeParse({
      leadId: "lead_1",
      inquiryType: "PROPERTY_QUESTION",
      sourceChannel: "website",
      customer: { name: "A", email: "a@b.co", phone: null, futureField: 1 },
      message: "Hello",
      property: { id: "p1", referenceCode: "PRN-1", somethingNew: true },
      utmSource: "facebook",
    });
    expect(result.success).toBe(true);
  });

  it("requires leadId and customer", () => {
    expect(leadCreatedSchema.safeParse({ message: "x" }).success).toBe(false);
  });
});
