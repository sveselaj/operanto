import "server-only";
import type { InboundEvent, OpportunityStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findOrCreateCustomer } from "@/lib/events/matching";
import {
  leadAssignedSchema,
  leadCreatedSchema,
  leadStatusChangedSchema,
  propertyEventSchema,
  staffEventSchema,
  viewingRequestedSchema,
  type PropertySnapshot,
} from "@/lib/events/envelope";

/**
 * Event → projection handlers. Every handler is idempotent: re-running the
 * same event must not create duplicate customers, opportunities, activities,
 * or tasks. Existence checks key on the source event id (`sourceEventId` in
 * activity metadata) or on upsert-able unique constraints.
 */

export type HandlerResult = {
  outcome: "projected" | "ignored";
  summary: string;
};

const FOLLOW_UP_SLA_HOURS = Number(process.env.OPERANTO_FOLLOWUP_SLA_HOURS ?? 4);

/**
 * Projection transactions run many sequential statements; against a remote
 * pooled database (Neon) each round-trip costs ~50–150 ms, so Prisma's 5 s
 * default interactive-transaction timeout is too tight. Failures here are
 * retried by the sweep, so a generous ceiling is safe.
 */
function projectionTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}

/** Pronatona lead status → Operanto opportunity stage. */
export function stageFromSourceStatus(status: string): OpportunityStage | null {
  const map: Record<string, OpportunityStage> = {
    NEW: "NEW",
    CONTACTED: "QUALIFYING",
    QUALIFYING: "QUALIFYING",
    VIEWING_REQUESTED: "VIEWING_REQUESTED",
    VIEWING_SCHEDULED: "VIEWING_SCHEDULED",
    OFFER: "OFFER",
    WON: "WON",
    LOST: "LOST",
    CLOSED: "CLOSED",
  };
  return map[status] ?? null;
}

type Tx = Prisma.TransactionClient;

function envelopeData(event: InboundEvent): Record<string, unknown> {
  const raw = event.rawPayload as { data?: Record<string, unknown> } | null;
  return raw?.data ?? {};
}

async function resolveStaffMembershipId(
  tx: Tx,
  event: InboundEvent,
  sourceStaffId: string | null | undefined,
): Promise<string | null> {
  if (!sourceStaffId) return null;
  const mapping = await tx.externalIdentityMapping.findUnique({
    where: {
      organisationId_sourceSystem_sourceEntityType_sourceEntityId: {
        organisationId: event.organisationId,
        sourceSystem: event.sourceSystem,
        sourceEntityType: "staff",
        sourceEntityId: sourceStaffId,
      },
    },
  });
  if (mapping?.operantoEntityType !== "membership") return null;
  const membership = await tx.membership.findFirst({
    where: {
      id: mapping.operantoEntityId,
      organisationId: event.organisationId,
      status: "ACTIVE",
    },
  });
  return membership?.id ?? null;
}

async function upsertPropertyContext(
  tx: Tx,
  event: InboundEvent,
  snapshot: PropertySnapshot,
): Promise<string> {
  const context = await tx.propertyContext.upsert({
    where: {
      organisationId_sourceSystem_sourcePropertyId: {
        organisationId: event.organisationId,
        sourceSystem: event.sourceSystem,
        sourcePropertyId: snapshot.id,
      },
    },
    create: {
      organisationId: event.organisationId,
      sourceSystem: event.sourceSystem,
      sourcePropertyId: snapshot.id,
      referenceCode: snapshot.referenceCode ?? null,
      title: snapshot.title ?? null,
      status: snapshot.status ?? null,
      price: snapshot.price ?? null,
      currency: snapshot.currency ?? null,
      city: snapshot.city ?? null,
      thumbnailUrl: snapshot.thumbnailUrl ?? null,
      sourceUrl: snapshot.publicUrl ?? null,
    },
    update: {
      referenceCode: snapshot.referenceCode ?? undefined,
      title: snapshot.title ?? undefined,
      status: snapshot.status ?? undefined,
      price: snapshot.price ?? undefined,
      currency: snapshot.currency ?? undefined,
      city: snapshot.city ?? undefined,
      thumbnailUrl: snapshot.thumbnailUrl ?? undefined,
      sourceUrl: snapshot.publicUrl ?? undefined,
    },
  });
  return context.id;
}

async function upsertMapping(
  tx: Tx,
  event: InboundEvent,
  sourceEntityType: string,
  sourceEntityId: string,
  operantoEntityType: string,
  operantoEntityId: string,
) {
  await tx.externalIdentityMapping.upsert({
    where: {
      organisationId_sourceSystem_sourceEntityType_sourceEntityId: {
        organisationId: event.organisationId,
        sourceSystem: event.sourceSystem,
        sourceEntityType,
        sourceEntityId,
      },
    },
    create: {
      organisationId: event.organisationId,
      sourceSystem: event.sourceSystem,
      sourceEntityType,
      sourceEntityId,
      operantoEntityType,
      operantoEntityId,
    },
    update: { operantoEntityType, operantoEntityId },
  });
}

/** Create an activity exactly once per (event, activityType). */
async function addActivityOnce(
  tx: Tx,
  event: InboundEvent,
  input: {
    activityType: string;
    summary: string;
    actorType?: "CUSTOMER" | "STAFF" | "SYSTEM" | "INTEGRATION";
    customerId?: string | null;
    opportunityId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const existing = await tx.activity.findFirst({
    where: {
      organisationId: event.organisationId,
      activityType: input.activityType,
      metadata: { path: ["sourceEventId"], equals: event.eventId },
    },
    select: { id: true },
  });
  if (existing) return;
  await tx.activity.create({
    data: {
      organisationId: event.organisationId,
      customerId: input.customerId ?? null,
      opportunityId: input.opportunityId ?? null,
      actorType: input.actorType ?? "INTEGRATION",
      activityType: input.activityType,
      sourceSystem: event.sourceSystem,
      summary: input.summary,
      metadata: { ...(input.metadata ?? {}), sourceEventId: event.eventId } as Prisma.InputJsonValue,
      occurredAt: event.occurredAt,
    },
  });
}

async function findOpportunityBySourceLead(
  tx: Tx,
  event: InboundEvent,
  leadId: string,
) {
  return tx.opportunity.findUnique({
    where: {
      organisationId_sourceSystem_sourceOpportunityId: {
        organisationId: event.organisationId,
        sourceSystem: event.sourceSystem,
        sourceOpportunityId: leadId,
      },
    },
  });
}

// ── lead.created / viewing.requested ────────────────────────────────

async function handleLeadCreated(
  event: InboundEvent,
  variant: "lead.created" | "viewing.requested",
): Promise<HandlerResult> {
  const schema = variant === "lead.created" ? leadCreatedSchema : viewingRequestedSchema;
  const data = schema.parse(envelopeData(event));

  await projectionTx(async (tx) => {
    const match = await findOrCreateCustomer(
      tx,
      event.organisationId,
      {
        sourceSystem: event.sourceSystem,
        // Pronatona has no separate customer entity yet; the lead id anchors
        // the source identity without implying cross-lead merging.
        sourceCustomerId: null,
        name: data.customer.name,
        email: data.customer.email,
        phone: data.customer.phone,
        preferredLanguage: data.customer.preferredLanguage,
        preferredChannel: data.customer.preferredChannel,
      },
      event.occurredAt,
    );

    const existing = await findOpportunityBySourceLead(tx, event, data.leadId);
    const assignedMembershipId = await resolveStaffMembershipId(
      tx,
      event,
      data.assignedAgentId,
    );

    const isViewing =
      variant === "viewing.requested" || data.inquiryType === "VIEWING_REQUEST";
    const preferredDate = data.preferredDate ? new Date(data.preferredDate) : null;

    const opportunity =
      existing ??
      (await tx.opportunity.create({
        data: {
          organisationId: event.organisationId,
          sourceSystem: event.sourceSystem,
          sourceOpportunityId: data.leadId,
          customerId: match.customerId,
          type: data.inquiryType ?? (isViewing ? "VIEWING_REQUEST" : "GENERAL_INQUIRY"),
          stage: isViewing ? "VIEWING_REQUESTED" : "NEW",
          sourceStage: "NEW",
          assignedMembershipId,
          sourceChannel: data.sourceChannel ?? null,
          summary: data.property?.referenceCode
            ? `Inquiry about ${data.property.referenceCode}`
            : data.propertyReference
              ? `Inquiry about ${data.propertyReference}`
              : "General inquiry",
          inquiryText: data.message ?? null,
          preferredDate:
            preferredDate && !Number.isNaN(preferredDate.getTime()) ? preferredDate : null,
          lastActivityAt: event.occurredAt,
        },
      }));

    if (existing) {
      await tx.opportunity.update({
        where: { id: existing.id },
        data: {
          lastActivityAt: event.occurredAt,
          ...(variant === "viewing.requested" &&
          !["WON", "LOST", "CLOSED"].includes(existing.stage)
            ? { stage: "VIEWING_REQUESTED" as const }
            : {}),
        },
      });
    }

    await upsertMapping(tx, event, "lead", data.leadId, "opportunity", opportunity.id);

    // Property context from the embedded snapshot (or minimal stub from ids).
    let propertyContextId: string | null = null;
    if (data.property?.id) {
      propertyContextId = await upsertPropertyContext(tx, event, data.property);
    } else if (data.propertyId) {
      propertyContextId = await upsertPropertyContext(tx, event, {
        id: data.propertyId,
        referenceCode: data.propertyReference ?? null,
      });
    }
    if (propertyContextId) {
      await tx.opportunityProperty.createMany({
        data: [{ opportunityId: opportunity.id, propertyContextId }],
        skipDuplicates: true,
      });
      await upsertMapping(
        tx,
        event,
        "property",
        data.property?.id ?? data.propertyId!,
        "property_context",
        propertyContextId,
      );
    }

    await addActivityOnce(tx, event, {
      activityType: variant === "viewing.requested" ? "viewing.requested" : "inquiry.received",
      actorType: "CUSTOMER",
      customerId: match.customerId,
      opportunityId: opportunity.id,
      summary:
        variant === "viewing.requested"
          ? `Viewing requested${preferredDate ? ` for ${data.preferredDate}` : ""}`
          : "Property inquiry received",
      metadata: {
        inquiryType: data.inquiryType,
        sourceChannel: data.sourceChannel,
        message: data.message,
        preferredDate: data.preferredDate,
      },
    });

    await addActivityOnce(tx, event, {
      activityType: match.created ? "customer.created" : "customer.matched",
      actorType: "SYSTEM",
      customerId: match.customerId,
      opportunityId: opportunity.id,
      summary: match.created
        ? "Customer record created"
        : `Customer matched (${match.matchReason.replace(/_/g, " ")})`,
      metadata: { matchReason: match.matchReason },
    });

    if (!existing) {
      await addActivityOnce(tx, event, {
        activityType: "opportunity.created",
        actorType: "SYSTEM",
        customerId: match.customerId,
        opportunityId: opportunity.id,
        summary: `Opportunity created (${opportunity.type})`,
        metadata: { stage: opportunity.stage },
      });
    }

    if (propertyContextId) {
      await addActivityOnce(tx, event, {
        activityType: "property.attached",
        actorType: "SYSTEM",
        opportunityId: opportunity.id,
        customerId: match.customerId,
        summary: `Property ${data.property?.referenceCode ?? data.propertyReference ?? ""} attached`.trim(),
        metadata: { propertyContextId },
      });
    }

    if (data.assignedAgentId && !assignedMembershipId) {
      await addActivityOnce(tx, event, {
        activityType: "assignment.unmapped",
        actorType: "SYSTEM",
        opportunityId: opportunity.id,
        summary: "Source assignee has no Operanto membership mapping",
        metadata: { sourceStaffId: data.assignedAgentId },
      });
    }

    // Follow-up task, exactly once per opportunity.
    const openFollowUp = await tx.task.findFirst({
      where: {
        organisationId: event.organisationId,
        opportunityId: opportunity.id,
        status: "OPEN",
      },
      select: { id: true },
    });
    if (!openFollowUp && !existing) {
      const dueAt = new Date(
        event.occurredAt.getTime() + FOLLOW_UP_SLA_HOURS * 3_600_000,
      );
      const task = await tx.task.create({
        data: {
          organisationId: event.organisationId,
          opportunityId: opportunity.id,
          assignedMembershipId,
          title: isViewing
            ? "Schedule requested property viewing"
            : "Respond to new property inquiry",
          description: data.message
            ? `Customer message:\n${data.message}`
            : null,
          priority: "HIGH",
          dueAt,
        },
      });
      await addActivityOnce(tx, event, {
        activityType: "task.created",
        actorType: "SYSTEM",
        opportunityId: opportunity.id,
        customerId: match.customerId,
        summary: `Follow-up task created: ${task.title}`,
        metadata: { taskId: task.id, dueAt: dueAt.toISOString() },
      });
    }
  });

  return { outcome: "projected", summary: `Lead ${data.leadId} projected` };
}

// ── lead.assigned ───────────────────────────────────────────────────

async function handleLeadAssigned(event: InboundEvent): Promise<HandlerResult> {
  const data = leadAssignedSchema.parse(envelopeData(event));

  await projectionTx(async (tx) => {
    const opportunity = await findOpportunityBySourceLead(tx, event, data.leadId);
    if (!opportunity) {
      throw new Error(
        `Opportunity for source lead ${data.leadId} not found (out-of-order event?)`,
      );
    }
    const membershipId = await resolveStaffMembershipId(tx, event, data.assignedAgentId);

    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: {
        assignedMembershipId: membershipId,
        lastActivityAt: event.occurredAt,
      },
    });

    await addActivityOnce(tx, event, {
      activityType: "assignment.changed",
      actorType: "INTEGRATION",
      opportunityId: opportunity.id,
      customerId: opportunity.customerId,
      summary: membershipId
        ? "Opportunity assigned"
        : data.assignedAgentId
          ? "Assigned in Pronatona to an unmapped staff member"
          : "Opportunity unassigned",
      metadata: {
        sourceStaffId: data.assignedAgentId,
        membershipId,
        previousSourceStaffId: data.previousAssignedAgentId,
      },
    });
  });

  return { outcome: "projected", summary: `Assignment for lead ${data.leadId} projected` };
}

// ── lead.status_changed ─────────────────────────────────────────────

async function handleLeadStatusChanged(event: InboundEvent): Promise<HandlerResult> {
  const data = leadStatusChangedSchema.parse(envelopeData(event));

  await projectionTx(async (tx) => {
    const opportunity = await findOpportunityBySourceLead(tx, event, data.leadId);
    if (!opportunity) {
      throw new Error(
        `Opportunity for source lead ${data.leadId} not found (out-of-order event?)`,
      );
    }
    const stage = stageFromSourceStatus(data.status);

    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: {
        ...(stage ? { stage } : {}),
        sourceStage: data.status,
        lastActivityAt: event.occurredAt,
      },
    });

    await addActivityOnce(tx, event, {
      activityType: "stage.changed",
      actorType: "INTEGRATION",
      opportunityId: opportunity.id,
      customerId: opportunity.customerId,
      summary: stage
        ? `Stage changed to ${stage} (source: ${data.status})`
        : `Source status changed to ${data.status} (no stage mapping)`,
      metadata: {
        fromStage: opportunity.stage,
        toStage: stage,
        sourceStatus: data.status,
        previousSourceStatus: data.previousStatus,
      },
    });
  });

  return { outcome: "projected", summary: `Status of lead ${data.leadId} projected` };
}

// ── property.published / property.updated / property.status_changed ─

async function handlePropertyEvent(event: InboundEvent): Promise<HandlerResult> {
  const data = propertyEventSchema.parse(envelopeData(event));

  await projectionTx(async (tx) => {
    const contextId = await upsertPropertyContext(tx, event, data);
    await upsertMapping(tx, event, "property", data.id, "property_context", contextId);

    if (event.eventType === "property.status_changed") {
      // Flag open opportunities that reference this property.
      const links = await tx.opportunityProperty.findMany({
        where: { propertyContextId: contextId },
        include: { opportunity: { select: { id: true, customerId: true, stage: true } } },
      });
      for (const link of links) {
        if (["WON", "LOST", "CLOSED"].includes(link.opportunity.stage)) continue;
        await addActivityOnce(tx, event, {
          activityType: "property.status_changed",
          actorType: "INTEGRATION",
          opportunityId: link.opportunity.id,
          customerId: link.opportunity.customerId,
          summary: `Linked property is now ${data.status ?? "updated"}`,
          metadata: { propertyContextId: contextId, status: data.status },
        });
      }
    }
  });

  return { outcome: "projected", summary: `Property ${data.id} context updated` };
}

// ── staff.activated / staff.suspended ───────────────────────────────

async function handleStaffEvent(event: InboundEvent): Promise<HandlerResult> {
  const data = staffEventSchema.parse(envelopeData(event));

  // Membership lifecycle in Operanto is invitation-only and admin-driven;
  // a source-system staff event must not suspend or create Operanto access
  // automatically. We record it so administrators can act (and the
  // integration health screen surfaces it). Historical activity is kept.
  await projectionTx(async (tx) => {
    const membershipId = await resolveStaffMembershipId(tx, event, data.userId);
    await addActivityOnce(tx, event, {
      activityType: event.eventType, // staff.activated | staff.suspended
      actorType: "INTEGRATION",
      summary:
        event.eventType === "staff.suspended"
          ? `Source staff ${data.email ?? data.userId} suspended in Pronatona${membershipId ? " — review their Operanto membership" : ""}`
          : `Source staff ${data.email ?? data.userId} activated in Pronatona`,
      metadata: {
        sourceStaffId: data.userId,
        mappedMembershipId: membershipId,
        role: data.role,
      },
    });
  });

  return { outcome: "projected", summary: `Staff event for ${data.userId} recorded` };
}

// ── Dispatch ────────────────────────────────────────────────────────

export async function handleEvent(event: InboundEvent): Promise<HandlerResult> {
  switch (event.eventType) {
    case "lead.created":
      return handleLeadCreated(event, "lead.created");
    case "viewing.requested":
      return handleLeadCreated(event, "viewing.requested");
    case "lead.assigned":
    case "viewing.assigned":
      return handleLeadAssigned(event);
    case "lead.status_changed":
      return handleLeadStatusChanged(event);
    case "property.published":
    case "property.updated":
    case "property.status_changed":
      return handlePropertyEvent(event);
    case "staff.activated":
    case "staff.suspended":
      return handleStaffEvent(event);
    default:
      // Unknown types are accepted and stored (forward compatibility) but not
      // projected. They surface on the integration health screen.
      return { outcome: "ignored", summary: `No handler for ${event.eventType}` };
  }
}
