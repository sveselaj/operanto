import type { ChannelType } from "@prisma/client";

/**
 * Normalized inbound message — every connector maps its provider payload into
 * this shape so the ingestion pipeline is channel-agnostic.
 */
export type NormalizedInbound = {
  channelAccountId: string;
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

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

export interface Channel {
  readonly type: ChannelType;
  /** Map a raw webhook payload into a normalized inbound message. */
  normalizeWebhook(payload: unknown): NormalizedInbound;
  /** Verify a webhook signature. Demo channels accept; real providers must verify. */
  verifySignature(headers: Headers, rawBody: string): boolean;
  /** Send an outbound message (stubbed for providers not yet credentialed). */
  sendMessage(to: string, body: string): Promise<{ externalMessageId?: string }>;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new ConnectorError("Invalid payload");
  return payload as Record<string, unknown>;
}

/**
 * Web-chat + manual connector. Works with no external credentials — the widget
 * and the in-app simulator POST this shape directly. This is the demoable path.
 */
class DirectConnector implements Channel {
  constructor(readonly type: ChannelType) {}

  normalizeWebhook(payload: unknown): NormalizedInbound {
    const p = asRecord(payload);
    const channelAccountId = String(p.channelAccountId ?? "");
    const body = String(p.body ?? "").trim();
    if (!channelAccountId) throw new ConnectorError("channelAccountId is required");
    if (!body) throw new ConnectorError("Message body is required");
    const customer = (p.customer ?? {}) as Record<string, unknown>;
    return {
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
    };
  }

  // Open widget/manual ingestion is gated by the unguessable channelAccountId.
  verifySignature(): boolean {
    return true;
  }

  async sendMessage(): Promise<{ externalMessageId?: string }> {
    // Web chat / manual delivery is handled in-app; nothing to send externally.
    return {};
  }
}

/**
 * Stub for providers that require credentials + webhook verification
 * (Meta/Instagram/Facebook, WhatsApp Cloud, Gmail, Twilio SMS). The interface is
 * implemented so the rest of the system is ready; methods refuse until wired.
 */
class ProviderStub implements Channel {
  constructor(readonly type: ChannelType) {}

  normalizeWebhook(): NormalizedInbound {
    throw new ConnectorError(`${this.type} connector is not configured yet`);
  }
  verifySignature(): boolean {
    return false; // reject inbound until real verification is implemented
  }
  async sendMessage(): Promise<{ externalMessageId?: string }> {
    throw new ConnectorError(`${this.type} sending is not configured yet`);
  }
}

const REGISTRY: Record<ChannelType, Channel> = {
  webchat: new DirectConnector("webchat"),
  manual: new DirectConnector("manual"),
  instagram: new ProviderStub("instagram"),
  facebook: new ProviderStub("facebook"),
  whatsapp: new ProviderStub("whatsapp"),
  email: new ProviderStub("email"),
  sms: new ProviderStub("sms"),
};

export function getConnector(type: ChannelType): Channel {
  return REGISTRY[type];
}

const VALID = new Set(Object.keys(REGISTRY));
export function isChannelType(value: string): value is ChannelType {
  return VALID.has(value);
}
