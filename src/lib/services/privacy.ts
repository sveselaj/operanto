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
  leads: number;
  activities: number;
  events: number;
  conversations: number;
  messages: number;
  channelIdentities: number;
  aiActions: number;
  computerSessions: number;
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

      // 2b. CRM leads linked to this customer (OI-3). Working-copy contact
      //     fields are exactly the personal data being erased; the pipeline
      //     row itself survives so status history and reporting stay intact.
      //     Leads that were never linked to a customer are pre-identity
      //     working data and are addressed by lead-level retention (OI-5).
      const leads = await tx.lead.updateMany({
        where: { ...scope(ctx), customerId: customer.id },
        data: {
          fullName: ERASED_TEXT,
          firstName: null,
          lastName: null,
          phone: null,
          phoneNormalized: null,
          phoneCountry: null,
          phoneNational: null,
          phoneExtension: null,
          secondaryPhone: null,
          email: null,
          emailNormalized: null,
          doNotCall: true,
        },
      });
      const leadRows = await tx.lead.findMany({
        where: { ...scope(ctx), customerId: customer.id },
        select: { id: true },
      });
      const leadIds = leadRows.map((l) => l.id);
      if (leadIds.length > 0) {
        await tx.activity.updateMany({
          where: { ...scope(ctx), leadId: { in: leadIds } },
          data: { summary: ERASED_TEXT, metadata: Prisma.DbNull },
        });
        await tx.task.updateMany({
          where: { ...scope(ctx), leadId: { in: leadIds } },
          data: { title: ERASED_TEXT, description: null },
        });
        // Call history (OI-4): the dialled number IS the personal datum, and
        // the free-text note routinely quotes the person. The attempt row
        // survives as evidence that a call happened, without its content.
        await tx.callAttempt.updateMany({
          where: { ...scope(ctx), leadId: { in: leadIds } },
          data: { dialedNumber: ERASED_TEXT, rawPhone: null, note: null },
        });
        // Work locks hold no personal data, but an open session on an erased
        // lead must not keep anyone in the call workspace.
        await tx.leadWorkLock.updateMany({
          where: { leadId: { in: leadIds }, releasedAt: null },
          data: { releasedAt: new Date(), releaseReason: "EXPIRED" },
        });
        // Notifications carry the person's name in metadata and point at the
        // lead; they are disposable operational signals, so they are deleted.
        await tx.notification.deleteMany({
          where: { ...scope(ctx), entityType: "Lead", entityId: { in: leadIds } },
        });
      }

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

      // 4. Tasks. The TITLE matters as much as the description: machine
      //    titles are generic, but staff type free text there ("Call Arta on
      //    +383…"), and it renders on /tasks next to the erased customer.
      if (opportunityIds.length > 0) {
        await tx.task.updateMany({
          where: { ...scope(ctx), opportunityId: { in: opportunityIds } },
          data: { title: ERASED_TEXT, description: null },
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
        // Tasks raised from these conversations get the same title treatment
        // as opportunity tasks: staff type free text there.
        await tx.task.updateMany({
          where: { ...scope(ctx), conversationId: { in: conversationIds } },
          data: { title: ERASED_TEXT, description: null },
        });
      }
      // Participant rows referencing this customer can also carry a display
      // name or a channel handle from before the record was linked.
      await tx.conversationParticipant.updateMany({
        where: { ...scope(ctx), customerId: customer.id },
        data: { displayName: null, externalRef: null },
      });
      // Channel identities are pure identifiers, so they are DELETED, not
      // redacted — keeping any of them would let the next inbound message
      // re-match the tombstone.
      const identities = await tx.customerIdentity.deleteMany({
        where: { ...scope(ctx), customerId: customer.id },
      });

      // AI surfaces: outputs and draft payloads are derived from the
      // customer's words, so they go the same way as the messages they came
      // from. The action's operational shell (task type, provider, model,
      // confidence, status, timestamps) survives — the person cannot be
      // reconstructed from it.
      const aiActions = await tx.aIAction.updateMany({
        where: {
          ...scope(ctx),
          OR: [
            { customerId: customer.id },
            ...(conversationIds.length > 0
              ? [{ conversationId: { in: conversationIds } }]
              : []),
          ],
        },
        data: {
          outputJson: { redacted: true },
          inputSummary: Prisma.DbNull,
          redactedAt: new Date(),
        },
      });
      if (conversationIds.length > 0) {
        await tx.approvalRequest.updateMany({
          where: { ...scope(ctx), conversationId: { in: conversationIds } },
          data: {
            originalPayload: { redacted: true },
            editedPayload: Prisma.DbNull,
            decisionReason: null,
            redactedAt: new Date(),
          },
        });
        // Raw channel payloads hold the customer's verbatim words.
        await tx.channelInboundEvent.updateMany({
          where: {
            ...scope(ctx),
            conversationId: { in: conversationIds },
            payloadRedactedAt: null,
          },
          data: {
            rawPayload: { redacted: true },
            payloadRedactedAt: new Date(),
          },
        });
      }
      // Computer C1: sessions carry the customer's goal text, plans/steps
      // the derived intent, actions the rationale and semantic targets,
      // snapshots the observed page identity and visible text. All of it is
      // customer-derived where the session is customer- or conversation-
      // linked, so it goes the way of the messages. Operational shells
      // (statuses, risk tiers, timestamps) survive.
      const computerSessionRows = await tx.computerSession.findMany({
        where: {
          ...scope(ctx),
          OR: [
            { customerId: customer.id },
            ...(conversationIds.length > 0
              ? [{ conversationId: { in: conversationIds } }]
              : []),
          ],
        },
        select: { id: true },
      });
      const computerSessionIds = computerSessionRows.map((row) => row.id);
      let computerSessions = 0;
      if (computerSessionIds.length > 0) {
        computerSessions = (
          await tx.computerSession.updateMany({
            where: { id: { in: computerSessionIds } },
            data: { goal: ERASED_TEXT, outcomeNote: null, redactedAt: new Date() },
          })
        ).count;
        await tx.computerPlan.updateMany({
          where: { sessionId: { in: computerSessionIds } },
          data: { summary: ERASED_TEXT, redactedAt: new Date() },
        });
        await tx.computerStep.updateMany({
          where: { plan: { sessionId: { in: computerSessionIds } } },
          data: { title: ERASED_TEXT, redactedAt: new Date() },
        });
        await tx.computerAction.updateMany({
          where: { sessionId: { in: computerSessionIds } },
          data: {
            reason: ERASED_TEXT,
            targetJson: Prisma.DbNull,
            verificationNote: null,
            redactedAt: new Date(),
          },
        });
        await tx.computerSnapshot.updateMany({
          where: { sessionId: { in: computerSessionIds } },
          data: {
            url: null,
            pageTitle: null,
            visibleTextSummary: ERASED_TEXT,
            semanticJson: Prisma.DbNull,
            redactedAt: new Date(),
          },
        });
        // Computer approval payloads duplicate the action's reason/target.
        // Conversation-linked ones were redacted above; customer-only
        // sessions have approvals without a conversation anchor, so sweep
        // by source action id.
        const actionRows = await tx.computerAction.findMany({
          where: { sessionId: { in: computerSessionIds } },
          select: { id: true },
        });
        if (actionRows.length > 0) {
          await tx.approvalRequest.updateMany({
            where: {
              ...scope(ctx),
              sourceType: "COMPUTER_ACTION",
              sourceId: { in: actionRows.map((row) => row.id) },
              redactedAt: null,
            },
            data: {
              originalPayload: { redacted: true },
              editedPayload: Prisma.DbNull,
              decisionReason: null,
              redactedAt: new Date(),
            },
          });
        }
      }

      // Dead-lettered or failed channel events may never have projected, so
      // they carry no conversation anchor. Scan the organisation's small set
      // of unattributed, unredacted events for the erased identity keys —
      // the same pattern the InboundEvent scan uses for source lead ids.
      const identityKeys = [
        customer.email,
        customer.emailNormalized,
        ...(await tx.customerIdentity.findMany({
          where: { ...scope(ctx), customerId: customer.id },
          select: { externalId: true },
        })).map((row) => row.externalId),
        ...(await tx.conversationParticipant.findMany({
          where: { ...scope(ctx), customerId: customer.id, externalRef: { not: null } },
          select: { externalRef: true },
        })).map((row) => row.externalRef),
      ].filter((key): key is string => Boolean(key));
      if (identityKeys.length > 0) {
        const unattributed = await tx.channelInboundEvent.findMany({
          where: { ...scope(ctx), conversationId: null, payloadRedactedAt: null },
          select: { id: true, rawPayload: true },
        });
        const affected = unattributed.filter((event) => {
          const blob = JSON.stringify(event.rawPayload);
          return identityKeys.some((key) => blob.includes(key));
        });
        for (const event of affected) {
          await tx.channelInboundEvent.update({
            where: { id: event.id },
            data: { rawPayload: { redacted: true }, payloadRedactedAt: new Date() },
          });
        }
      }

      // 6. The source lead id is a foreign key straight back to the person in
      //    Pronatona. Clearing the payload copy while leaving it on the
      //    projection would defeat the whole exercise — and it would also let
      //    a later event match the tombstone by source id and refill it.
      if (opportunityIds.length > 0) {
        await tx.opportunity.updateMany({
          where: { ...scope(ctx), id: { in: opportunityIds } },
          data: { sourceOpportunityId: null },
        });
        await tx.externalIdentityMapping.deleteMany({
          where: {
            ...scope(ctx),
            operantoEntityType: "opportunity",
            operantoEntityId: { in: opportunityIds },
          },
        });
      }

      // 7. The raw inbound events — a verbatim copy of everything received.
      //    Queried by correlationId and by the leadId inside the payload, so
      //    the database does the filtering: loading every event in the tenant
      //    to filter in memory does not survive real volume.
      //
      //    Rows the RETENTION sweep already touched are deliberately included:
      //    that sweep keeps correlationId on purpose, so skipping them here
      //    would leave the re-identification key on exactly the older events.
      let events = 0;
      if (sourceLeadIds.length > 0) {
        const affected = await tx.inboundEvent.findMany({
          where: {
            ...scope(ctx),
            OR: [
              { correlationId: { in: sourceLeadIds } },
              ...sourceLeadIds.map((leadId) => ({
                rawPayload: {
                  path: ["data", "leadId"],
                  equals: leadId,
                } as Prisma.JsonFilter,
              })),
            ],
          },
          select: { id: true, rawPayload: true },
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

      // 7. Audit metadata. The trail of WHAT happened must survive, but staff
      //    actions recorded free text (task titles) and the source lead id,
      //    so those values are cleared while the rows remain.
      await tx.auditEvent.updateMany({
        where: {
          ...scope(ctx),
          OR: [
            { targetType: "Customer", targetId: customer.id },
            ...(opportunityIds.length > 0
              ? [{ targetType: "Opportunity", targetId: { in: opportunityIds } }]
              : []),
            ...(sourceLeadIds.length > 0
              ? [{ correlationId: { in: sourceLeadIds } }]
              : []),
          ],
        },
        data: {
          beforeMetadata: Prisma.DbNull,
          afterMetadata: Prisma.DbNull,
          correlationId: null,
        },
      });

      return {
        customerId: customer.id,
        opportunities: opportunities.count,
        leads: leads.count,
        activities: activities.count,
        events,
        conversations: conversationIds.length,
        messages,
        channelIdentities: identities.count,
        aiActions: aiActions.count,
        computerSessions,
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
      channelIdentitiesDeleted: result.channelIdentities,
      aiActionsRedacted: result.aiActions,
      computerSessionsRedacted: result.computerSessions,
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
 * event is old, keeping a verbatim copy of a customer's name, phone and
 * message is pure liability — so this runs on the same schedule as the retry
 * sweep.
 *
 * It applies to EVERY status, not only PROCESSED. A dead-lettered event never
 * succeeds and never produces a customer, so it is reachable by neither retry
 * nor erasure: excluding it here is what made its payload permanent. The
 * retention window is the debugging budget for a failing event — past it, the
 * payload goes and `lastError` plus the envelope remain. `processInboundEvent`
 * refuses to claim a redacted event, so nothing can be replayed from a husk.
 */
export async function redactExpiredPayloads(limit = 500): Promise<{
  scanned: number;
  redacted: number;
  retentionDays: number;
}> {
  const retentionDays = payloadRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  // Every status, not just PROCESSED. A DEAD_LETTER event can never be
  // retried (the sweep excludes it once attempts are exhausted) and never
  // produced a customer to erase from, so filtering on PROCESSED left its
  // verbatim payload — name, email, phone, message — stored forever with no
  // path to remove it. The envelope and `lastError` remain for diagnosis.
  const expired = await prisma.inboundEvent.findMany({
    where: { payloadRedactedAt: null, receivedAt: { lt: cutoff } },
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
 * Retention sweep for conversation message bodies AND AI-derived content.
 * AI outputs and draft payloads never outlive the messages they were built
 * from, so the same per-organisation window governs both. Restriction holds
 * a customer's rows untouched (Art. 18 pauses disposal); erasure never waits
 * for this sweep.
 */
export async function redactExpiredMessages(): Promise<{
  organisations: number;
  redacted: number;
  aiRedacted: number;
}> {
  const organisations = await prisma.organisation.findMany({
    select: { id: true, messageRetentionDays: true },
  });

  let redacted = 0;
  let aiRedacted = 0;
  for (const organisation of organisations) {
    const retentionDays = messageRetentionDays(organisation.messageRetentionDays);
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    // Restriction of processing (Art. 18) pauses DISPOSAL as much as use:
    // a restricted customer may need the data preserved while a dispute
    // runs, so their rows are held untouched until the restriction lifts.
    // Erasure, by contrast, never waits — it redacts immediately through
    // eraseCustomer regardless of age.
    const notRestricted = {
      OR: [{ customerId: null }, { customer: { restrictedAt: null } }],
    };
    const result = await prisma.message.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        conversation: notRestricted,
      },
      data: {
        body: RETENTION_EXPIRED_TEXT,
        metadata: Prisma.DbNull,
        redactedAt: new Date(),
      },
    });
    redacted += result.count;

    const aiResult = await prisma.aIAction.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        ...notRestricted,
      },
      data: {
        outputJson: { expired: true },
        inputSummary: Prisma.DbNull,
        redactedAt: new Date(),
      },
    });
    const approvalResult = await prisma.approvalRequest.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        requestedAt: { lt: cutoff },
        conversation: notRestricted,
      },
      data: {
        originalPayload: { expired: true },
        editedPayload: Prisma.DbNull,
        decisionReason: null,
        redactedAt: new Date(),
      },
    });
    aiRedacted += aiResult.count + approvalResult.count;
  }

  return { organisations: organisations.length, redacted, aiRedacted };
}

/**
 * Retention sweep for Computer C1 content — goals, plan summaries, step
 * titles, action rationales/targets, snapshot page identity and visible
 * text. Same per-organisation message window as messages and AI outputs
 * (Computer context never outlives the conversations it served), and the
 * same Art. 18 rule: a restricted customer's sessions are held untouched.
 * Approval payloads for computer actions are swept by source id because
 * customer-only sessions have no conversation anchor for the message sweep
 * to find.
 */
export async function redactExpiredComputerContent(): Promise<{
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
    const notRestricted = {
      OR: [{ customerId: null }, { customer: { restrictedAt: null } }],
    };
    const sessionResult = await prisma.computerSession.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        ...notRestricted,
      },
      data: {
        goal: RETENTION_EXPIRED_TEXT,
        outcomeNote: null,
        redactedAt: new Date(),
      },
    });
    const planResult = await prisma.computerPlan.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        session: notRestricted,
      },
      data: { summary: RETENTION_EXPIRED_TEXT, redactedAt: new Date() },
    });
    const stepResult = await prisma.computerStep.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        plan: { session: notRestricted },
      },
      data: { title: RETENTION_EXPIRED_TEXT, redactedAt: new Date() },
    });
    const actionResult = await prisma.computerAction.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        session: notRestricted,
      },
      data: {
        reason: RETENTION_EXPIRED_TEXT,
        targetJson: Prisma.DbNull,
        verificationNote: null,
        redactedAt: new Date(),
      },
    });
    const snapshotResult = await prisma.computerSnapshot.updateMany({
      where: {
        organisationId: organisation.id,
        redactedAt: null,
        createdAt: { lt: cutoff },
        session: notRestricted,
      },
      data: {
        url: null,
        pageTitle: null,
        visibleTextSummary: RETENTION_EXPIRED_TEXT,
        semanticJson: Prisma.DbNull,
        redactedAt: new Date(),
      },
    });
    // Approval payload copies, restriction-aware via the source action's
    // session (ApprovalRequest.sourceId is not a relation, so resolve the
    // exempt ids first).
    const restrictedActionRows = await prisma.computerAction.findMany({
      where: {
        organisationId: organisation.id,
        session: { customer: { restrictedAt: { not: null } } },
      },
      select: { id: true },
    });
    const approvalResult = await prisma.approvalRequest.updateMany({
      where: {
        organisationId: organisation.id,
        sourceType: "COMPUTER_ACTION",
        redactedAt: null,
        requestedAt: { lt: cutoff },
        ...(restrictedActionRows.length > 0
          ? { sourceId: { notIn: restrictedActionRows.map((row) => row.id) } }
          : {}),
      },
      data: {
        originalPayload: { expired: true },
        editedPayload: Prisma.DbNull,
        decisionReason: null,
        redactedAt: new Date(),
      },
    });
    redacted +=
      sessionResult.count +
      planResult.count +
      stepResult.count +
      actionResult.count +
      snapshotResult.count +
      approvalResult.count;
  }

  return { organisations: organisations.length, redacted };
}

/**
 * Retention sweep for raw CHANNEL payloads — same rationale and window as
 * InboundEvent.rawPayload (OPERANTO_PAYLOAD_RETENTION_DAYS, default 30).
 * ALL statuses are swept: FAILED and DEAD_LETTER rows keep their payloads
 * for replay only WITHIN the window — replay value expires with it, and no
 * dead-letter row may retain a raw payload indefinitely. The operational
 * shell (status, attempts, error, timestamps) survives for auditability.
 */
export async function redactExpiredChannelPayloads(limit = 500): Promise<{
  redacted: number;
  retentionDays: number;
}> {
  const retentionDays = payloadRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const expired = await prisma.channelInboundEvent.findMany({
    where: { payloadRedactedAt: null, receivedAt: { lt: cutoff } },
    select: { id: true },
    take: limit,
  });
  const result = await prisma.channelInboundEvent.updateMany({
    where: { id: { in: expired.map((row) => row.id) }, payloadRedactedAt: null },
    data: { rawPayload: { redacted: true }, payloadRedactedAt: new Date() },
  });
  return { redacted: result.count, retentionDays };
}

/**
 * Prospect-data retention (Growth G1). Prospect personal data must not
 * live forever on the strength of a CSV import: contacts belonging to
 * accounts that ended in REJECTED, SUPPRESSED or NOT_NOW are PII-redacted
 * after OPERANTO_PROSPECT_RETENTION_DAYS (default 365). Redaction is
 * in-place (the shell survives for dedupe and audit continuity), and
 * suppression entries are untouched — the objection outlives the data.
 */
export async function redactExpiredGrowthContacts(limit = 500): Promise<{
  redacted: number;
}> {
  const days = Number(process.env.OPERANTO_PROSPECT_RETENTION_DAYS ?? 365);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const expired = await prisma.growthContact.findMany({
    where: {
      redactedAt: null,
      updatedAt: { lt: cutoff },
      account: { status: { in: ["REJECTED", "SUPPRESSED", "NOT_NOW"] } },
    },
    select: { id: true },
    take: limit,
  });
  if (expired.length === 0) return { redacted: 0 };
  const result = await prisma.growthContact.updateMany({
    where: { id: { in: expired.map((row) => row.id) }, redactedAt: null },
    data: {
      firstName: null,
      lastName: null,
      email: null,
      emailNormalized: null,
      phone: null,
      profileUrl: null,
      redactedAt: new Date(),
    },
  });
  return { redacted: result.count };
}
