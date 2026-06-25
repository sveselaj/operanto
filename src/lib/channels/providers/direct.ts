import type { ChannelType } from "@prisma/client";
import {
  asRecord,
  isDeliveryStatus,
  ConnectorError,
  type Channel,
  type NormalizedInbound,
  type NormalizedStatus,
} from "../types";

/**
 * Web-chat + manual connector. Works with no external credentials — the widget
 * and the in-app simulator POST a normalized body directly, gated by the
 * unguessable channelAccountId. This is the demoable path.
 */
export class DirectConnector implements Channel {
  constructor(readonly type: ChannelType) {}

  verifyChallenge(): string | null {
    return null;
  }

  // Open widget/manual ingestion is gated by the unguessable channelAccountId.
  verifySignature(): boolean {
    return true;
  }

  classifyEvent(payload: unknown): "message" | "status" {
    const p = asRecord(payload);
    return p.type === "status" || (p.status && p.externalMessageId) ? "status" : "message";
  }

  accountRef(payload: unknown): string | null {
    const p = asRecord(payload);
    return typeof p.channelAccountId === "string" ? p.channelAccountId : null;
  }

  normalizeWebhook(payload: unknown): NormalizedInbound[] {
    const p = asRecord(payload);
    const channelAccountId = String(p.channelAccountId ?? "");
    const body = String(p.body ?? "").trim();
    if (!channelAccountId) throw new ConnectorError("channelAccountId is required");
    if (!body) throw new ConnectorError("Message body is required");
    const customer = (p.customer ?? {}) as Record<string, unknown>;
    return [
      {
        channelAccountId,
        body,
        externalMessageId: p.externalMessageId ? String(p.externalMessageId) : null,
        customer: {
          name: customer.name ? String(customer.name) : null,
          email: customer.email ? String(customer.email) : null,
          phone: customer.phone ? String(customer.phone) : null,
          handle: customer.handle ? String(customer.handle) : null,
          externalId: customer.externalId ? String(customer.externalId) : null,
        },
      },
    ];
  }

  normalizeStatus(payload: unknown): NormalizedStatus[] {
    const p = asRecord(payload);
    const externalMessageId = p.externalMessageId ? String(p.externalMessageId) : "";
    const status = String(p.status ?? "");
    if (!externalMessageId || !isDeliveryStatus(status)) return [];
    return [{ externalMessageId, status, error: p.error ? String(p.error) : null }];
  }

  async sendMessage(): Promise<{ externalMessageId?: string }> {
    // Web chat / manual delivery is handled in-app; nothing to send externally.
    return {};
  }

  isConfigured(): boolean {
    return true;
  }
}
