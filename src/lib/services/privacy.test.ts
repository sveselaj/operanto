import { describe, expect, it, vi } from "vitest";
import {
  messageRetentionDays,
  payloadRetentionDays,
  redactPayload,
} from "@/lib/privacy-redaction";

/**
 * These tests are about what must be GONE. The database-touching paths are
 * exercised against staging in the acceptance suite; here the concern is the
 * redaction function itself, which is what decides whether personal data
 * survives in a stored event payload.
 */

const REAL_EVENT = {
  eventId: "evt_1",
  eventType: "lead.created",
  schemaVersion: 1,
  occurredAt: "2026-07-31T09:30:00.000Z",
  source: "PRONATONA_WEB",
  organisationId: "org_pronatona",
  correlationId: "lead_1",
  actor: { type: "CUSTOMER", userId: null, membershipId: null },
  data: {
    leadId: "lead_1",
    customer: {
      name: "Arta Krasniqi",
      email: "arta@example.com",
      phone: "+38344123456",
      preferredLanguage: "sq",
    },
    message: "A është ende në shitje banesa PRN-A1B2C3?",
    property: { referenceCode: "PRN-A1B2C3", price: 185000 },
  },
};

describe("redactPayload", () => {
  it("removes every personal field from a stored event", () => {
    const serialised = JSON.stringify(redactPayload(REAL_EVENT));
    expect(serialised).not.toContain("Arta");
    expect(serialised).not.toContain("arta@example.com");
    expect(serialised).not.toContain("38344123456");
    expect(serialised).not.toContain("shitje");
  });

  it("keeps the source correlation id for routine retention", () => {
    // Not personal data on its own, and it is what makes an old event
    // traceable when something needs explaining.
    expect(redactPayload(REAL_EVENT).correlationId).toBe("lead_1");
  });

  it("unlinks the source correlation id for an erasure request", () => {
    // After erasure the row must not point back at the person in Pronatona.
    const erased = redactPayload(REAL_EVENT, { unlink: true });
    expect(erased.correlationId).toBeNull();
    expect(JSON.stringify(erased)).not.toContain("lead_1");
  });

  it("keeps only what operations need to reason about the event", () => {
    expect(redactPayload(REAL_EVENT)).toEqual({
      eventId: "evt_1",
      eventType: "lead.created",
      schemaVersion: 1,
      occurredAt: "2026-07-31T09:30:00.000Z",
      source: "PRONATONA_WEB",
      organisationId: "org_pronatona",
      correlationId: "lead_1",
      redacted: true,
    });
  });

  it("drops the entire data object rather than trying to prune it", () => {
    // Allow-listing the envelope means a future producer field carrying
    // personal data is redacted by default instead of leaking until noticed.
    const withNewField = {
      ...REAL_EVENT,
      data: { ...REAL_EVENT.data, futureSensitiveField: "national id" },
    };
    expect(JSON.stringify(redactPayload(withNewField))).not.toContain("national id");
    expect("data" in redactPayload(withNewField)).toBe(false);
  });

  it("survives a malformed or already-redacted payload", () => {
    expect(redactPayload(null)).toMatchObject({ redacted: true, eventId: null });
    expect(redactPayload({} as never)).toMatchObject({ redacted: true });
    expect(redactPayload(redactPayload(REAL_EVENT) as never)).toMatchObject({
      eventId: "evt_1",
      redacted: true,
    });
  });

  it("does not carry over a non-string field that pretends to be an id", () => {
    const hostile = { ...REAL_EVENT, eventId: { toString: () => "leak" } };
    expect(redactPayload(hostile as never).eventId).toBeNull();
  });
});

describe("payloadRetentionDays", () => {
  it("defaults to 30 days", () => {
    vi.stubEnv("OPERANTO_PAYLOAD_RETENTION_DAYS", "");
    expect(payloadRetentionDays()).toBe(30);
    vi.unstubAllEnvs();
  });

  it("accepts a configured window", () => {
    vi.stubEnv("OPERANTO_PAYLOAD_RETENTION_DAYS", "7");
    expect(payloadRetentionDays()).toBe(7);
    vi.unstubAllEnvs();
  });

  it("falls back rather than accepting a nonsensical window", () => {
    for (const bad of ["0", "-5", "not-a-number"]) {
      vi.stubEnv("OPERANTO_PAYLOAD_RETENTION_DAYS", bad);
      expect(payloadRetentionDays()).toBe(30);
    }
    vi.unstubAllEnvs();
  });
});

describe("messageRetentionDays", () => {
  it("defaults to the provisional 12 months", () => {
    vi.stubEnv("OPERANTO_MESSAGE_RETENTION_DAYS", "");
    expect(messageRetentionDays()).toBe(365);
    vi.unstubAllEnvs();
  });

  it("prefers the per-organisation override", () => {
    vi.stubEnv("OPERANTO_MESSAGE_RETENTION_DAYS", "500");
    expect(messageRetentionDays(90)).toBe(90);
    vi.unstubAllEnvs();
  });

  it("falls through nonsensical overrides to the environment, then the default", () => {
    vi.stubEnv("OPERANTO_MESSAGE_RETENTION_DAYS", "180");
    expect(messageRetentionDays(0)).toBe(180);
    expect(messageRetentionDays(-3)).toBe(180);
    expect(messageRetentionDays(null)).toBe(180);
    vi.unstubAllEnvs();
    vi.stubEnv("OPERANTO_MESSAGE_RETENTION_DAYS", "not-a-number");
    expect(messageRetentionDays(null)).toBe(365);
    vi.unstubAllEnvs();
  });
});
