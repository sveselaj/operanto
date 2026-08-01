import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import {
  messageRetentionDays,
  payloadRetentionDays,
  redactPayload,
} from "@/lib/privacy-redaction";

export {
  messageRetentionDays,
  payloadRetentionDays,
  redactPayload,
} from "@/lib/privacy-redaction";

/**
 * Privacy lifecycle: erasure, restriction of processing, and retention.
 *
 * Operanto holds a *projection* of personal data that originates in a source
 * system, which means erasure has to happen in both places — see
 * docs/privacy.md. This module covers the Operanto side.
 *
 * Design decision: erasure **redacts in place** rather than deleting rows.
 * Deleting a customer would cascade away the opportunities, timeline and the
 * evidence that the erasure happened at all, which is exactly what you need to
 * keep in order to demonstrate compliance. What survives is a tombstone with
 * no personal data in it: the fact that an inquiry existed, its stage, and
 * when it was erased.
 */

/** Every place a customer's personal data can come to rest. */
const ERASED_TEXT = "[erased]";

export type ErasureResult = {
  customerId: string;
  opportunities: number;
  activities: number;
  events: number;
  conversations: number;
  messages: number;
};

/**
 * Erase a customer's personal data across every surface that holds it.
 *
 * Covers: the customer record itself (including the normalized matching keys,
 * so the person can never be re-matched to this row), inquiry free text on
 * opportunities, activity summaries and metadata, and the raw inbound event
 * payloads — which are the easiest surface to forget, because they hold a
 * verbatim copy of everything the customer ever sent.
 */
export async function eraseCustomer(
  ctx: OrgContext,
  customerId: string,
  reason: string,
): Promise<ErasureResult> {
  // Erasure is destructive and organisation-wide in effect; operators must not
  // be able to trigger it from a record they happen to be assigned.
  requirePermission(ctx.membership.role, "privacy:manage");

  const customer = await prisma.customer.findFirst({
    where: { ...scope(ctx), id: customerId },
    include: { opportunities: { select: { id: true, sourceOpportunityId: true } } },
  });
  if (!customer) throw new Error("Customer not found");
  if (customer.erasedAt) throw new Error("This customer has already been erased");

  const opportunityIds = customer.opportunities.map((o) => o.id);
  const sourceLeadIds = customer.opportunities
    .map((o) => o.sourceOpportunityId)
    .filter((id): id is string => Boolean(id));

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. The customer record. Matching keys are cleared too: leaving them
      //    would let the next inbound event re-attach this person to the
      //    tombstone and repopulate it.
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          name: ERASED_TEXT,
          email: null,
          emailNormalized: null,
          phone: null,
          phoneNormalized: null,
          preferredLanguage: null,
          preferredChannel: null,
          sourceCustomerId: null,
          matchReason: null,
          erasedAt: new Date(),
        },
      });

      // 2. Free text the customer wrote, and the summaries derived from it.
      const opportunities = await tx.opportunity.updateMany({
        where: { ...scope(ctx), customerId: customer.id },
        data: { inquiryText: null, summary: ERASED_TEXT },
      });

      // 3. Timeline. Summaries are human-readable and often quote the person;
      //    metadata carries the original message and identity fields.
      const activities = await tx.activity.updateMany({
        where: { ...scope(ctx), customerId: customer.id },
        data: { summary: ERASED_TEXT, metadata: Prisma.DbNull },
      });
      if (opportunityIds.length > 0) {
        await tx.activity.updateMany({
          where: { ...scope(ctx), opportunityId: { in: opportunityIds } },
          data: { summary: ERASED_TEXT, metadata: Prisma.DbNull },
        });
      }

      // 4. Task descriptions are seeded with the customer's message.
      if (opportunityIds.length > 0) {
        await tx.task.updateMany({
          where: { ...scope(ctx), opportunityId: { in: opportunityIds } },
          data: { description: null },
        });
      }

      // 5. Conversations. Message bodies (all senders, not only the
      //    customer's — staff replies quote the person), internal notes,
      //    subjects, and the display identity on participant rows.
      const conversationRows = await tx.conversation.findMany({
        where: { ...scope(ctx), customerId: customer.id },
        select: { id: true },
      });
      const conversationIds = conversationRows.map((c) => c.id);
      let messages = 0;
      if (conversationIds.length > 0) {
        await tx.conversation.updateMany({
          where: { ...scope(ctx), id: { in: conversationIds } },
          data: { subject: ERASED_TEXT },
        });
        const redactedMessages = await tx.message.updateMany({
          where: { ...scope(ctx), conversationId: { in: conversationIds } },
          data: { body: ERASED_TEXT, metadata: Prisma.DbNull, redactedAt: new Date() },
        });
        messages = redactedMessages.count;
        await tx.conversationNote.updateMany({
          where: { ...scope(ctx), conversationId: { in: conversationIds } },
          data: { body: ERASED_TEXT },
        });
        await tx.activity.updateMany({
          where: { ...scope(ctx), conversationId: { in: conversationIds } },
          data: { summary: ERASED_TEXT, metadata: Prisma.DbNull },
        });
      }
      // Participant rows referencing this customer can also carry a display
      // name or a channel handle from before the record was linked.
      await tx.conversationParticipant.updateMany({
        where: { ...scope(ctx), customerId: customer.id },
        data: { displayName: null, externalRef: null },
      });

      // 6. The raw inbound events — a verbatim copy of everything received.
      //    Matched by the source lead ids this customer's opportunities came
      //    from, since that is the only link back to the originating event.
      let events = 0;
      if (sourceLeadIds.length > 0) {
        const candidates = await tx.inboundEvent.findMany({
          where: { ...scope(ctx), payloadRedactedAt: null },
          select: { id: true, rawPayload: true },
        });
        const affected = candidates.filter((event) => {
          const data = (event.rawPayload as { data?: { leadId?: string } } | null)?.data;
          return data?.leadId ? sourceLeadIds.includes(data.leadId) : false;
        });
        for (const event of affected) {
          await tx.inboundEvent.update({
            where: { id: event.id },
            data: {
              rawPayload: redactPayload(event.rawPayload, { unlink: true }),
              // The column copy is the same link, so it goes too.
              correlationId: null,
              payloadRedactedAt: new Date(),
            },
          });
        }
        events = affected.length;
      }

      return {
        customerId: customer.id,
        opportunities: opportunities.count,
        activities: activities.count,
        events,
        conversations: conversationIds.length,
        messages,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  // The audit entry deliberately records WHAT was erased and why, never the
  // erased values themselves.
  await audit(ctx, {
    eventType: "privacy.customer_erased",
    targetType: "Customer",
    targetId: customer.id,
    after: {
      reason: reason.slice(0, 500),
      opportunitiesRedacted: result.opportunities,
      activitiesRedacted: result.activities,
      eventPayloadsRedacted: result.events,
      conversationsRedacted: result.conversations,
      messagesRedacted: result.messages,
    },
  });

  return result;
}

/**
 * Restrict or resume processing for a customer (GDPR Art. 18). Data is
 * retained; what changes is that the record is flagged everywhere it is shown,
 * and no new follow-up work is generated for it.
 */
export async function setProcessingRestriction(
  ctx: OrgContext,
  customerId: string,
  restricted: boolean,
): Promise<void> {
  requirePermission(ctx.membership.role, "privacy:manage");
  const customer = await prisma.customer.findFirst({
    where: { ...scope(ctx), id: customerId },
  });
  if (!customer) throw new Error("Customer not found");

  await prisma.customer.update({
    where: { id: customer.id },
    data: { restrictedAt: restricted ? new Date() : null },
  });
  await audit(ctx, {
    eventType: restricted
      ? "privacy.processing_restricted"
      : "privacy.processing_resumed",
    targetType: "Customer",
    targetId: customer.id,
  });
}

/**
 * Retention sweep: redact raw payloads older than the retention window.
 *
 * Raw payloads exist so a failed event can be replayed and debugged. Once an
 * event is processed and old, keeping a verbatim copy of a customer's name,
 * phone and message is pure liability — so this runs on the same schedule as
 * the retry sweep. Only PROCESSED events are touched: anything still failing
 * or dead-lettered may still need its payload to be recovered.
 */
export async function redactExpiredPayloads(limit = 500): Promise<{
  scanned: number;
  redacted: number;
  retentionDays: number;
}> {
  const retentionDays = payloadRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  const expired = await prisma.inboundEvent.findMany({
    where: {
      payloadRedactedAt: null,
      processingStatus: "PROCESSED",
      receivedAt: { lt: cutoff },
    },
    select: { id: true, rawPayload: true, organisationId: true },
    take: limit,
  });

  for (const event of expired) {
    await prisma.inboundEvent.update({
      where: { id: event.id },
      data: {
        rawPayload: redactPayload(event.rawPayload),
        payloadRedactedAt: new Date(),
      },
    });
  }

  return { scanned: expired.length, redacted: expired.length, retentionDays };
}

const RETENTION_EXPIRED_TEXT = "[expired]";

/**
 * Retention sweep for conversation message bodies. The window is configurable
 * per organisation (`Organisation.messageRetentionDays`), defaulting to the
 * provisional 12 months; erasure requests do not wait for it — they redact
 * immediately via eraseCustomer. Bodies are replaced in place and the row
 * survives, so the conversation's shape (who wrote when, over which channel)
 * remains intact for operations and audit.
 */
export async function redactExpiredMessages(): Promise<{
  organisations: number;
  redacted: number;
}> {
  const organisations = await prisma.organisation.findMany({
    select: { id: true, messageRetentionDays: true },
  });

  let redacted = 0;
  for (const organisation of organisations) {
    const retentionDays = messageRetentionDays(organisation.messageRetentionDays);
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const result = await prisma.message.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
      },
      data: {
        body: RETENTION_EXPIRED_TEXT,
        metadata: Prisma.DbNull,
        redactedAt: new Date(),
      },
    });
    redacted += result.count;
  }

  return { organisations: organisations.length, redacted };
}
