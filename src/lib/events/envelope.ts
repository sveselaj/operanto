import { z } from "zod";

/**
 * Wire contract for inbound Pronatona events (docs/event-schema.md).
 *
 * The envelope is validated strictly; `data` payloads are validated per event
 * type by the handlers with tolerant schemas (unknown extra fields are allowed
 * so additive producer changes do not break ingestion).
 */

export const MAX_EVENT_BODY_BYTES = 256_000;
/** Accepted clock skew between producer timestamp and our clock. */
export const REPLAY_WINDOW_SECONDS = 300;

export const eventEnvelopeSchema = z.object({
  eventId: z.string().min(8).max(128),
  eventType: z.string().min(3).max(64),
  schemaVersion: z.number().int().min(1).max(100),
  occurredAt: z.iso.datetime(),
  source: z.string().min(2).max(64),
  organisationId: z.string().min(1).max(128),
  correlationId: z.string().max(128).nullish(),
  actor: z
    .object({
      type: z.enum(["CUSTOMER", "STAFF", "SYSTEM", "CONNECTOR"]),
      userId: z.string().max(128).nullish(),
      membershipId: z.string().max(128).nullish(),
    })
    .optional(),
  data: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

// ── Per-event payload schemas (tolerant: .loose() keeps unknown keys) ──

const propertySnapshotSchema = z
  .object({
    id: z.string(),
    referenceCode: z.string().nullish(),
    title: z.string().nullish(),
    status: z.string().nullish(),
    price: z.number().nullish(),
    currency: z.string().nullish(),
    city: z.string().nullish(),
    publicUrl: z.string().nullish(),
    thumbnailUrl: z.string().nullish(),
    assignedAgentId: z.string().nullish(),
  })
  .loose();

export const leadCreatedSchema = z
  .object({
    leadId: z.string(),
    inquiryType: z.string().nullish(),
    sourceChannel: z.string().nullish(),
    customer: z
      .object({
        name: z.string().nullish(),
        email: z.string().nullish(),
        phone: z.string().nullish(),
        preferredLanguage: z.string().nullish(),
        preferredChannel: z.string().nullish(),
      })
      .loose(),
    message: z.string().nullish(),
    preferredDate: z.string().nullish(),
    propertyId: z.string().nullish(),
    propertyReference: z.string().nullish(),
    assignedAgentId: z.string().nullish(),
    property: propertySnapshotSchema.nullish(),
  })
  .loose();

export const leadAssignedSchema = z
  .object({
    leadId: z.string(),
    assignedAgentId: z.string().nullish(),
    previousAssignedAgentId: z.string().nullish(),
  })
  .loose();

export const leadStatusChangedSchema = z
  .object({
    leadId: z.string(),
    status: z.string(),
    previousStatus: z.string().nullish(),
  })
  .loose();

export const propertyEventSchema = z
  .object({
    // property.* events carry the snapshot at top level alongside legacy keys
    id: z.string(),
    referenceCode: z.string().nullish(),
    title: z.string().nullish(),
    status: z.string().nullish(),
    price: z.number().nullish(),
    currency: z.string().nullish(),
    city: z.string().nullish(),
    publicUrl: z.string().nullish(),
    thumbnailUrl: z.string().nullish(),
    assignedAgentId: z.string().nullish(),
  })
  .loose();

export const viewingRequestedSchema = leadCreatedSchema;

export const staffEventSchema = z
  .object({
    userId: z.string(),
    membershipId: z.string().nullish(),
    email: z.string().nullish(),
    name: z.string().nullish(),
    role: z.string().nullish(),
  })
  .loose();

export type PropertySnapshot = z.infer<typeof propertySnapshotSchema>;
