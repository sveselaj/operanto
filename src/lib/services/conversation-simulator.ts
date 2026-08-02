import "server-only";
import { prisma } from "@/lib/prisma";
import { auditSystem } from "@/lib/audit";
import type { SimulatorPayload } from "@/lib/channels/simulator-adapter";
import {
  processChannelInboundEvent,
  storeChannelPayload,
} from "@/lib/services/channel-ingest";

/**
 * Deterministic conversation simulator — development, tests, and staging ONLY.
 *
 * Since Slice 5A it is a thin driver over the CANONICAL channel pipeline: it
 * builds a synthetic provider payload and pushes it through the same
 * store-then-process path every live adapter will use (tenant-safe dedupe by
 * constraint, atomic claim, identity ladder, consent keywords, delivery
 * statuses). No randomness, no external calls, no AI, no outbound sends.
 *
 * Guard rails unchanged: refuses production unless OPERANTO_SIMULATOR_ENABLED=1;
 * linking is exact-match only and never touches erased tombstones.
 */

export type SimulatorScenarioKey = "nagelista" | "pronatona";

type SimulatorScenario = {
  key: SimulatorScenarioKey;
  providerThreadId: string;
  providerMessageId: string;
  subject: string;
  senderDisplayName: string;
  senderExternalRef: string;
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

export async function ingestSimulatedMessage(
  organisationId: string,
  scenarioKey: SimulatorScenarioKey,
  options: { runId?: string } = {},
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

  const connection = await prisma.channelConnection.upsert({
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

  const payload: SimulatorPayload = {
    simulator: true,
    connectionId: connection.id,
    eventId: scenario.providerMessageId,
    kind: "message",
    thread: scenario.providerThreadId,
    message: {
      id: scenario.providerMessageId,
      body: scenario.body,
      subject: scenario.subject,
      timestamp: new Date().toISOString(),
      sender: {
        externalId: scenario.senderExternalRef,
        displayName: scenario.senderDisplayName,
        email: scenario.linkEmail,
      },
    },
  };

  const stored = await storeChannelPayload("SIMULATOR", payload);
  if ("rejected" in stored) {
    throw new Error(`Simulator payload rejected: ${stored.rejected}`);
  }
  if (stored.duplicate) {
    const conversation = await prisma.conversation.findUnique({
      where: {
        organisationId_channelConnectionId_providerThreadId: {
          organisationId,
          channelConnectionId: connection.id,
          providerThreadId: scenario.providerThreadId,
        },
      },
      select: { id: true, customerId: true },
    });
    if (!conversation) {
      throw new Error(
        "Duplicate simulator event but its conversation no longer exists — use a fresh runId",
      );
    }
    return {
      conversationId: conversation.id,
      messageId: null,
      customerId: conversation.customerId,
      duplicate: true,
    };
  }

  const result = await processChannelInboundEvent(stored.eventId);
  if (result.status !== "PROCESSED" || !result.conversationId) {
    throw new Error(`Simulator event did not process (status: ${result.status})`);
  }

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

  return {
    conversationId: result.conversationId,
    messageId: result.messageId,
    customerId: result.customerId,
    duplicate: false,
  };
}
