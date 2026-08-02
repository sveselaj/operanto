import type { ChannelConnection, ChannelType, MessageDeliveryStatus } from "@prisma/client";

/**
 * Provider-neutral channel adapter contract (Slice 5A foundation).
 *
 * An adapter turns provider payloads into normalized events and (in a later
 * slice) transmits explicit outbound sends. Rules the pipeline enforces
 * regardless of adapter behaviour:
 * - an adapter that cannot resolve a tenant REJECTS the event — there is no
 *   cross-tenant fallback lookup, ever;
 * - signature verification receives the resolved connection, so per-tenant
 *   secrets are possible even where v1 uses app-level secrets;
 * - normalized events are data; nothing in them is executed.
 *
 * Slice 5A ships exactly one adapter (the deterministic simulator) and no
 * outbound transmission: `sendMessage` exists on the interface as the Slice
 * 5B contract and must throw until a live connector implements it.
 */

export type NormalizedInboundMessage = {
  kind: "message";
  providerThreadId: string;
  providerMessageId: string;
  providerTimestamp: Date | null;
  sender: {
    externalId: string | null;
    displayName: string | null;
    email: string | null;
  };
  subject: string | null;
  body: string;
};

export type NormalizedDeliveryStatus = {
  kind: "status";
  providerMessageId: string;
  deliveryStatus: MessageDeliveryStatus;
  errorMessage: string | null;
};

export type NormalizedChannelEvent = NormalizedInboundMessage | NormalizedDeliveryStatus;

export type SendMessageInput = {
  connection: ChannelConnection;
  providerThreadId: string | null;
  recipientExternalId: string;
  body: string;
};

export type SendMessageResult = {
  providerMessageId: string;
};

export type ConnectionStatus = {
  healthy: boolean;
  detail: string | null;
};

export interface ConversationChannelAdapter {
  readonly type: ChannelType;
  /** Provider GET handshake (e.g. hub.challenge); null when unsupported. */
  verifyChallenge(url: URL): string | null;
  /** Verify a raw payload against the RESOLVED connection's secret. */
  verifySignature(
    headers: Headers,
    rawBody: string,
    connection: ChannelConnection,
  ): boolean;
  classifyEvent(payload: unknown): "message" | "status" | "ignore";
  /** Provider account reference used to resolve the tenant; null = reject. */
  connectionRef(payload: unknown): string | null;
  /** Provider idempotency key for the payload; null = reject (unstorable). */
  dedupeKey(payload: unknown): string | null;
  receiveEvents(payload: unknown): NormalizedChannelEvent[];
  /** Slice 5B contract — MUST throw in every Slice 5A adapter. */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  verifyConnection(connection: ChannelConnection): Promise<ConnectionStatus>;
}

export class ChannelAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelAdapterError";
  }
}
