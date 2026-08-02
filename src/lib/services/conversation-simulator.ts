import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditSystem } from "@/lib/audit";
import { normalizeEmail } from "@/lib/normalize";
import { resolveCustomerByChannelIdentity } from "@/lib/services/customer-identity";

/**
 * Deterministic conversation simulator — development, tests, and staging ONLY.
 *
 * It stands in for a live channel adapter: normalised inbound messages enter
 * through the same shapes (connection → thread → message, dedupe by unique
 * constraint) that a real adapter will use in a later slice. No randomness,
 * no external calls, no AI, no outbound sends.
 *
 * Guard rails:
 * - Refuses to run in production unless OPERANTO_SIMULATOR_ENABLED=1 is set
 *   explicitly (mirrors the seed's test-fixture guard).
 * - Customer linking uses exact e-mail matching only, never fuzzy rules, and
 *   never matches erased tombstones — consistent with the identity ladder in
 *   src/lib/events/matching.ts. Restricted customers are stored-and-held,
 *   like inbound integration events.
 */

export type SimulatorScenarioKey = "nagelista" | "pronatona";

type SimulatorScenario = {
  key: SimulatorScenarioKey;
  /** Stable thread id — re-running a scenario is an idempotent duplicate. */
  providerThreadId: string;
  providerMessageId: string;
  subject: string;
  senderDisplayName: string;
  senderExternalRef: string;
  /** Linked when a customer with exactly this e-mail exists (and is not erased). */
  linkEmail: string;
  body: string;
};

export const SIMULATOR_SCENARIOS: Record<SimulatorScenarioKey, SimulatorScenario> = {
  nagelista: {
    key: "nagelista",
    providerThreadId: "sim-nagelista-thread-001",
    providerMessageId: "sim-nagelista-msg-001",
    subject: "Order status — nail set",
    senderDisplayName: "Nagelista shopper",
    senderExternalRef: "sim:nagelista:shopper-001",
    linkEmail: "shopper@nagelista.test",
    body:
      "Hello, I ordered a nail set last week. Can you tell me whether it has been shipped?",
  },
  pronatona: {
    key: "pronatona",
    providerThreadId: "sim-pronatona-thread-001",
    providerMessageId: "sim-pronatona-msg-001",
    subject: "Apartment search — Prishtina",
    senderDisplayName: "Pronatona lead",
    senderExternalRef: "sim:pronatona:lead-001",
    linkEmail: "lead@pronatona.test",
    body:
      "I am looking for an apartment in Prishtina with two bedrooms and a budget up to €150,000.",
  },
};

export function isSimulatorEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.OPERANTO_SIMULATOR_ENABLED === "1";
}

export type SimulatedIngestResult = {
  conversationId: string;
  messageId: string | null;
  customerId: string | null;
  duplicate: boolean;
};

/**
 * Ingest one scenario message for an organisation. Runs with SYSTEM authority
 * (there is no signed-in user during channel ingestion), but every write is
 * explicitly organisation-scoped and audited.
 */
export async function ingestSimulatedMessage(
  organisationId: string,
  scenarioKey: SimulatorScenarioKey,
  options: {
    /**
     * Optional deterministic run id appended to the scenario's thread and
     * message ids, so test harnesses can replay a scenario as a NEW thread
     * (e.g. one per e2e run) while staying fully reproducible within a run.
     */
    runId?: string;
  } = {},
): Promise<SimulatedIngestResult> {
  if (!isSimulatorEnabled()) {
    throw new Error(
      "The conversation simulator is disabled in production (set OPERANTO_SIMULATOR_ENABLED=1 to allow it on a staging deployment)",
    );
  }
  const base = SIMULATOR_SCENARIOS[scenarioKey];
  if (!base) throw new Error(`Unknown simulator scenario: ${scenarioKey}`);
  const runId = options.runId?.trim();
  if (runId && !/^[a-z0-9-]{1,40}$/i.test(runId)) {
    throw new Error("runId must be 1–40 alphanumeric/dash characters");
  }
  const scenario = runId
    ? {
        ...base,
        providerThreadId: `${base.providerThreadId}-${runId}`,
        providerMessageId: `${base.providerMessageId}-${runId}`,
      }
    : base;

  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
  });
  if (!organisation) throw new Error("Organisation not found");

  const result = await prisma.$transaction(async (tx) => {
    const connection = await tx.channelConnection.upsert({
      where: {
        organisationId_type_displayName: {
          organisationId,
          type: "SIMULATOR",
          displayName: "Simulator",
        },
      },
      update: {},
      create: { organisationId, type: "SIMULATOR", displayName: "Simulator" },
    });

    // Identity ladder for channel ingestion, exact matches only, erased
    // tombstones never re-matched: 1) a taught channel identity for this
    // sender (see linkConversationCustomer — linking "teaches" the handle),
    // 2) the scenario's e-mail. Never fuzzy, never creates customers.
    const customer =
      (await resolveCustomerByChannelIdentity(
        tx,
        organisationId,
        "SIMULATOR",
        scenario.senderExternalRef,
      )) ??
      (await tx.customer.findFirst({
        where: {
          organisationId,
          erasedAt: null,
          emailNormalized: normalizeEmail(scenario.linkEmail),
        },
      }));

    const now = new Date();
    const existing = await tx.conversation.findUnique({
      where: {
        organisationId_channelConnectionId_providerThreadId: {
          organisationId,
          channelConnectionId: connection.id,
          providerThreadId: scenario.providerThreadId,
        },
      },
    });

    const conversation =
      existing ??
      (await tx.conversation.create({
        data: {
          organisationId,
          customerId: customer?.id ?? null,
          channelConnectionId: connection.id,
          channelType: "SIMULATOR",
          providerThreadId: scenario.providerThreadId,
          subject: scenario.subject,
          lastMessageAt: now,
          lastInboundAt: now,
        },
      }));

    if (!existing) {
      await tx.conversationParticipant.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          type: "CUSTOMER",
          customerId: customer?.id ?? null,
          displayName: customer ? null : scenario.senderDisplayName,
          externalRef: scenario.senderExternalRef,
        },
      });
      await tx.activity.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          customerId: customer?.id ?? null,
          actorType: "SYSTEM",
          activityType: "conversation.created",
          sourceSystem: "SIMULATOR",
          summary: "Conversation opened by simulated inbound message",
        },
      });
    }

    let messageId: string | null = null;
    let duplicate = false;
    try {
      const message = await tx.message.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          channelConnectionId: connection.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          body: scenario.body,
          providerMessageId: scenario.providerMessageId,
          providerTimestamp: now,
          metadata: { simulatorScenario: scenario.key },
        },
      });
      messageId = message.id;
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastInboundAt: now },
      });
      await tx.activity.create({
        data: {
          organisationId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          actorType: "CUSTOMER",
          activityType: "conversation.inbound_message",
          sourceSystem: "SIMULATOR",
          summary: "Inbound message received (simulator)",
        },
      });
    } catch (error) {
      // The tenancy-scoped unique constraint is the dedupe mechanism: a
      // replayed provider message id is a no-op duplicate, exactly as the
      // event pipeline treats replayed event ids.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        duplicate = true;
      } else {
        throw error;
      }
    }

    return {
      conversationId: conversation.id,
      messageId,
      customerId: conversation.customerId,
      duplicate,
    };
  });

  if (!result.duplicate) {
    await auditSystem(organisationId, "SYSTEM", {
      eventType: "conversation.inbound_received",
      targetType: "Conversation",
      targetId: result.conversationId,
      after: {
        scenario: scenario.key,
        messageId: result.messageId,
        customerId: result.customerId,
        channelType: "SIMULATOR",
      },
    });
  }
  return result;
}
