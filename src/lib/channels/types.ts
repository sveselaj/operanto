import type { ChannelType } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Connector contract shared by the demo (web chat / manual) and live provider
 * connectors. Kept in its own module so providers and the registry import the
 * same types without a cycle.
 */

/**
 * Normalized inbound message. Demo connectors set `channelAccountId` directly;
 * live connectors only know the provider-side receiving account, so they set
 * `providerAccountId` and the webhook route resolves the ChannelAccount.
 */
export type NormalizedInbound = {
  channelAccountId?: string | null;
  providerAccountId?: string | null;
  customer: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    handle?: string | null;
    externalId?: string | null;
  };
  body: string;
  externalMessageId?: string | null;
};

/** Delivery lifecycle reported by a provider's status webhook. */
export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type NormalizedStatus = {
  externalMessageId: string;
  status: DeliveryStatus;
  error?: string | null;
};

/** Per-account credentials (decrypted) that override env config when sending. */
export type ChannelCredentials = {
  accessToken?: string | null;
  externalAccountId?: string | null; // phone_number_id / page id / sender id
  metadata?: Record<string, unknown> | null;
};

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

export interface Channel {
  readonly type: ChannelType;
  /** GET verification handshake (Meta family). Returns the challenge to echo, or null. */
  verifyChallenge(url: URL): string | null;
  /** Verify an inbound POST. Live providers require configured secrets. */
  verifySignature(headers: Headers, rawBody: string): boolean;
  /** Classify a verified payload as an inbound message or a delivery-status update. */
  classifyEvent(payload: unknown): "message" | "status";
  /** Provider-side receiving account id, used to resolve the Operanto ChannelAccount. */
  accountRef(payload: unknown): string | null;
  /** Normalize a (possibly batched) webhook into inbound messages. */
  normalizeWebhook(payload: unknown): NormalizedInbound[];
  /** Normalize delivery-status updates from a status webhook. */
  normalizeStatus(payload: unknown): NormalizedStatus[];
  /** Send an outbound message. `creds` (decrypted, per-account) override env config. */
  sendMessage(
    to: string,
    body: string,
    creds?: ChannelCredentials,
  ): Promise<{ externalMessageId?: string }>;
  /** Whether this connector can send (env and/or per-account credentials present). */
  isConfigured(creds?: ChannelCredentials): boolean;
}

export function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new ConnectorError("Invalid payload");
  return payload as Record<string, unknown>;
}

export function isDeliveryStatus(v: string): v is DeliveryStatus {
  return v === "sent" || v === "delivered" || v === "read" || v === "failed";
}

/** Hex HMAC-SHA256 of `raw` keyed by `secret` (for X-Hub-Signature-256). */
export function hmacSha256Hex(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

/** Constant-time string compare that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
