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
 * Slice 5A shipped exactly one adapter (the deterministic simulator), which
 * must always throw from `sendMessage`. Slice 5B adds the WhatsApp Cloud
 * adapter — its `sendMessage` is reachable ONLY through the explicit
 * sendWhatsAppMessage service operation and its server-side recheck chain.
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
  /**
   * Safe media metadata only (first-release policy): provider media id, mime
   * type and filename — never a provider URL or token. `pending: true` marks
   * the visible media_pending state until binary retrieval ships.
   */
  media?: {
    pending: true;
    kind: string;
    providerMediaId: string;
    mimeType: string | null;
    filename: string | null;
  } | null;
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
  /** Organisation-authorized template (required outside the service window). */
  template?: { name: string; language: string } | null;
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
  /**
   * Verify a raw payload BEFORE any tenant data processing. Adapters whose
   * secret is deployment-level (the Operanto-managed Meta app) receive null
   * here; adapters with per-tenant secrets receive the resolved connection.
   */
  verifySignature(
    headers: Headers,
    rawBody: string,
    connection: ChannelConnection | null,
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
