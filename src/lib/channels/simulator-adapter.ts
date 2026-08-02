import type { ChannelConnection } from "@prisma/client";
import {
  ChannelAdapterError,
  type ConnectionStatus,
  type ConversationChannelAdapter,
  type NormalizedChannelEvent,
  type SendMessageInput,
  type SendMessageResult,
} from "@/lib/channels/types";

/**
 * The deterministic simulator on the canonical adapter interface — the
 * reference implementation every live connector follows. Payloads are
 * synthetic (built by the simulator service), verification is structural
 * (payloads never arrive over the network), and sending is impossible.
 */

export type SimulatorPayload = {
  simulator: true;
  connectionId: string;
  eventId: string;
  kind: "message" | "status";
  thread?: string;
  message?: {
    id: string;
    body: string;
    subject: string | null;
    timestamp: string;
    sender: {
      externalId: string | null;
      displayName: string | null;
      email: string | null;
    };
  };
  status?: {
    providerMessageId: string;
    deliveryStatus: "SENT" | "DELIVERED" | "READ" | "FAILED";
    errorMessage: string | null;
  };
};

function isSimulatorPayload(payload: unknown): payload is SimulatorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { simulator?: unknown }).simulator === true
  );
}

export class SimulatorChannelAdapter implements ConversationChannelAdapter {
  readonly type = "SIMULATOR" as const;

  verifyChallenge(): string | null {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verifySignature(_headers: Headers, _rawBody: string, _connection: ChannelConnection): boolean {
    // Simulator payloads are constructed in-process by the simulator service
    // and never arrive over the network; structural validation is the check.
    return true;
  }

  classifyEvent(payload: unknown): "message" | "status" | "ignore" {
    if (!isSimulatorPayload(payload)) return "ignore";
    return payload.kind;
  }

  connectionRef(payload: unknown): string | null {
    return isSimulatorPayload(payload) ? payload.connectionId : null;
  }

  dedupeKey(payload: unknown): string | null {
    return isSimulatorPayload(payload) ? payload.eventId : null;
  }

  receiveEvents(payload: unknown): NormalizedChannelEvent[] {
    if (!isSimulatorPayload(payload)) return [];
    if (payload.kind === "message" && payload.message && payload.thread) {
      return [
        {
          kind: "message",
          providerThreadId: payload.thread,
          providerMessageId: payload.message.id,
          providerTimestamp: new Date(payload.message.timestamp),
          sender: payload.message.sender,
          subject: payload.message.subject,
          body: payload.message.body,
        },
      ];
    }
    if (payload.kind === "status" && payload.status) {
      return [
        {
          kind: "status",
          providerMessageId: payload.status.providerMessageId,
          deliveryStatus: payload.status.deliveryStatus,
          errorMessage: payload.status.errorMessage,
        },
      ];
    }
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    // Slice 5A invariant: no adapter transmits anything.
    throw new ChannelAdapterError(
      "The simulator channel cannot send — outbound transmission arrives with a live connector slice",
    );
  }

  async verifyConnection(connection: ChannelConnection): Promise<ConnectionStatus> {
    return {
      healthy: connection.status === "ACTIVE",
      detail: connection.status === "ACTIVE" ? null : "Connection is disabled",
    };
  }
}
