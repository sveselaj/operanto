import { z } from "zod";
import { ActivityOutcome, ImportStrategy, LeadStatus, NotificationType } from "@operanto/crm-domain";

/**
 * CRM domain event contracts (OI-2; docs/OPERANTO_EVENT_MODEL.md).
 *
 * Contracts only: payloads carry ids and domain facts — never UI concerns
 * (no labels, colors, routes, i18n strings). Inside the deployment, events
 * remain transactional side effects (Activity + audit + notification written
 * in the producing service's transaction — the Operanto "two event stores, no
 * bus" rule); these schemas define the shape those facts take when a consumer
 * needs them (assistant tools, future outbox dispatch, OI-3+ integration).
 */

const isoDate = z.union([z.date(), z.iso.datetime()]);

const actor = z.object({
  type: z.enum(["STAFF", "SYSTEM", "INTEGRATION", "CUSTOMER"]),
  /** Membership/user id where type is STAFF; null otherwise. */
  actorId: z.string().nullable(),
});

/** Envelope aligned with Operanto's signed-event envelope (schemaVersion 1). */
export const domainEventEnvelope = z.object({
  eventId: z.string(),
  eventType: z.string(),
  schemaVersion: z.literal(1),
  occurredAt: isoDate,
  organisationId: z.string(),
  /** Correlates related events (e.g. the lead id for a lead's lifecycle). */
  correlationId: z.string().nullable(),
  actor,
});

export const CRM_EVENT_PAYLOADS = {
  "crm.lead.created": z.object({
    leadId: z.string(),
    source: z.string().nullable(),
    /** Provenance: what produced the lead. */
    origin: z.enum(["import", "contact_request", "growth_handoff", "manual"]),
    campaignId: z.string().nullable(),
  }),
  "crm.lead.assigned": z.object({
    leadId: z.string(),
    assigneeId: z.string().nullable(),
    previousAssigneeId: z.string().nullable(),
    poolId: z.string().nullable(),
    bulk: z.boolean(),
  }),
  "crm.lead.status_changed": z.object({
    leadId: z.string(),
    previousStatus: z.enum(LeadStatus),
    newStatus: z.enum(LeadStatus),
    reason: z.string().nullable(),
  }),
  /** Specializations of status_changed for the two business-critical exits. */
  "crm.lead.qualified": z.object({ leadId: z.string() }),
  "crm.lead.rejected": z.object({ leadId: z.string(), reason: z.string() }),
  "crm.callback.scheduled": z.object({
    leadId: z.string(),
    taskId: z.string(),
    dueAt: isoDate,
    rescheduled: z.boolean(),
  }),
  "crm.call.started": z.object({
    leadId: z.string(),
    callAttemptId: z.string(),
    provider: z.string(),
  }),
  "crm.call.outcome_recorded": z.object({
    leadId: z.string(),
    callAttemptId: z.string(),
    outcome: z.enum(ActivityOutcome),
    durationSeconds: z.number().int().nullable(),
  }),
  "crm.appointment.created": z.object({
    leadId: z.string(),
    appointmentId: z.string(),
    startAt: isoDate,
    endAt: isoDate,
  }),
  "crm.appointment.moved": z.object({
    leadId: z.string(),
    appointmentId: z.string(),
    startAt: isoDate,
    endAt: isoDate,
    previousStartAt: isoDate,
  }),
  "crm.import.completed": z.object({
    importJobId: z.string(),
    strategy: z.enum(ImportStrategy),
    imported: z.number().int(),
    updated: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    reviewRequired: z.number().int(),
  }),
  "crm.duplicate.resolved": z.object({
    importRowId: z.string(),
    resolution: z.string(),
    targetLeadId: z.string().nullable(),
  }),
  "crm.contact_request.received": z.object({
    contactRequestId: z.string(),
    source: z.string(),
    matchedLeadId: z.string().nullable(),
  }),
  "crm.notification.created": z.object({
    notificationId: z.string(),
    recipientId: z.string(),
    type: z.enum(NotificationType),
  }),
  "crm.assistant.conversation_started": z.object({
    assistantConversationId: z.string(),
    locale: z.string(),
  }),
  /** Owned by Operanto; mirrored here so CRM consumers can validate them. */
  "conversation.received": z.object({
    conversationId: z.string(),
    channelType: z.string(),
    customerId: z.string().nullable(),
  }),
  "customer.created": z.object({
    customerId: z.string(),
    matchReason: z.string().nullable(),
  }),
} as const;

export type CrmEventType = keyof typeof CRM_EVENT_PAYLOADS;

export type CrmDomainEvent<T extends CrmEventType = CrmEventType> = z.infer<
  typeof domainEventEnvelope
> & {
  eventType: T;
  payload: z.infer<(typeof CRM_EVENT_PAYLOADS)[T]>;
};

/** Validate an event against its payload schema; throws ZodError on mismatch. */
export function validateDomainEvent(event: {
  eventType: string;
  payload: unknown;
  [key: string]: unknown;
}): CrmDomainEvent {
  const envelope = domainEventEnvelope.parse(event);
  const schema = CRM_EVENT_PAYLOADS[event.eventType as CrmEventType];
  if (!schema) throw new Error(`Unknown CRM event type: ${event.eventType}`);
  return {
    ...envelope,
    eventType: event.eventType as CrmEventType,
    payload: schema.parse(event.payload),
  } as CrmDomainEvent;
}

/**
 * Consumer seam. No implementation ships in OI-2 — inside the deployment,
 * facts are written transactionally; a sink implementation (outbox, test spy)
 * arrives with the first real consumer (OI-3+).
 */
export interface DomainEventSink {
  publish(event: CrmDomainEvent): Promise<void>;
}

/** Canonical intake sources for contact requests (provenance vocabulary). */
export const CONTACT_REQUEST_SOURCES = [
  "website",
  "whatsapp",
  "instagram",
  "facebook",
  "email",
  "phone",
  "api",
  "growth",
  "conversation_ai",
  "manual",
] as const;
export type ContactRequestSource = (typeof CONTACT_REQUEST_SOURCES)[number];
