import { describe, expect, it } from "vitest";
import {
  CRM_EVENT_PAYLOADS,
  CONTACT_REQUEST_SOURCES,
  validateDomainEvent,
} from "./events";
import { mergeTimeline, timelineItem, timelineItemId } from "./timeline";

const envelope = {
  eventId: "evt_1",
  schemaVersion: 1 as const,
  occurredAt: new Date("2026-08-05T10:00:00Z"),
  organisationId: "org_1",
  correlationId: "lead_1",
  actor: { type: "STAFF" as const, actorId: "user_1" },
};

describe("domain event contracts", () => {
  it("validates a lead status change", () => {
    const event = validateDomainEvent({
      ...envelope,
      eventType: "crm.lead.status_changed",
      payload: {
        leadId: "lead_1",
        previousStatus: "NEW",
        newStatus: "CONTACTED",
        reason: null,
      },
    });
    expect(event.eventType).toBe("crm.lead.status_changed");
  });

  it("rejects unknown event types and bad payloads", () => {
    expect(() =>
      validateDomainEvent({ ...envelope, eventType: "crm.lead.exploded", payload: {} })
    ).toThrow(/Unknown CRM event type/);
    expect(() =>
      validateDomainEvent({
        ...envelope,
        eventType: "crm.lead.status_changed",
        payload: { leadId: "lead_1", previousStatus: "NEW", newStatus: "NOT_A_STATUS", reason: null },
      })
    ).toThrow();
  });

  it("keeps payloads free of UI concerns", () => {
    const forbidden = /label|color|icon|route|href|title[A-Z]|messageKey/i;
    for (const [type, schema] of Object.entries(CRM_EVENT_PAYLOADS)) {
      for (const key of Object.keys(schema.shape)) {
        expect(`${type}.${key}`).not.toMatch(forbidden);
      }
    }
  });

  it("covers the OI-2 catalog", () => {
    for (const required of [
      "crm.lead.created",
      "crm.lead.assigned",
      "crm.lead.qualified",
      "crm.lead.rejected",
      "conversation.received",
      "crm.call.started",
      "crm.call.outcome_recorded",
      "crm.callback.scheduled",
      "crm.appointment.created",
      "crm.appointment.moved",
      "crm.import.completed",
      "crm.duplicate.resolved",
      "customer.created",
      "crm.notification.created",
      "crm.assistant.conversation_started",
    ]) {
      expect(Object.keys(CRM_EVENT_PAYLOADS)).toContain(required);
    }
  });

  it("defines the canonical contact-request sources", () => {
    for (const s of ["website", "whatsapp", "api", "growth", "conversation_ai"]) {
      expect(CONTACT_REQUEST_SOURCES).toContain(s);
    }
  });
});

describe("timeline contract", () => {
  const base = {
    kind: "activity" as const,
    type: "crm.call_attempted",
    refs: {
      organisationId: "org_1",
      customerId: null,
      leadId: "lead_1",
      conversationId: null,
      actorId: "user_1",
      entityId: "act_1",
    },
    facts: { outcome: "NO_ANSWER" },
  };

  it("merges streams newest-first with a stable tie-break", () => {
    const a = timelineItem.parse({
      ...base,
      id: timelineItemId("activity", "act_1"),
      occurredAt: new Date("2026-08-05T09:00:00Z"),
    });
    const b = timelineItem.parse({
      ...base,
      id: timelineItemId("task", "task_1"),
      kind: "task",
      type: "CALLBACK",
      occurredAt: new Date("2026-08-05T10:00:00Z"),
    });
    const c = timelineItem.parse({
      ...base,
      id: timelineItemId("activity", "act_0"),
      occurredAt: new Date("2026-08-05T09:00:00Z"),
    });
    expect(mergeTimeline([a], [b, c]).map((i) => i.id)).toEqual([
      "task:task_1",
      "activity:act_0",
      "activity:act_1",
    ]);
  });
});
