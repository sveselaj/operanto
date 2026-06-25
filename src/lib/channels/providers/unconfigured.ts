import type { ChannelType } from "@prisma/client";
import {
  ConnectorError,
  type Channel,
  type NormalizedInbound,
  type NormalizedStatus,
} from "../types";

/**
 * Placeholder for channels whose connector isn't implemented yet (e.g. email,
 * which needs SMTP/IMAP wiring). Refuses inbound and outbound so the rest of the
 * system stays type-complete and safe until a real connector lands.
 */
export class UnconfiguredConnector implements Channel {
  constructor(readonly type: ChannelType) {}
  verifyChallenge(): string | null {
    return null;
  }
  verifySignature(): boolean {
    return false;
  }
  classifyEvent(): "message" | "status" {
    return "message";
  }
  accountRef(): string | null {
    return null;
  }
  normalizeWebhook(): NormalizedInbound[] {
    throw new ConnectorError(`${this.type} connector is not configured yet`);
  }
  normalizeStatus(): NormalizedStatus[] {
    return [];
  }
  async sendMessage(): Promise<{ externalMessageId?: string }> {
    throw new ConnectorError(`${this.type} sending is not configured yet`);
  }
  isConfigured(): boolean {
    return false;
  }
}
