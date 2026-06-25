import type { ChannelType } from "@prisma/client";
import {
  asRecord,
  safeEqual,
  ConnectorError,
  type Channel,
  type ChannelCredentials,
  type DeliveryStatus,
  type NormalizedInbound,
  type NormalizedStatus,
} from "../types";
import { infobipConfig } from "../config";

/**
 * Infobip connectors — Viber and SMS.
 *
 * Inbound MO messages and delivery reports arrive as `{ results: [...] }`.
 * Verification is the optional shared secret (X-Webhook-Secret) matched against
 * INFOBIP_WEBHOOK_SECRET (a.k.a. WEBHOOK_SECRET). Sends use `Authorization: App
 * <key>` against the configured base URL.
 */

/** Map an Infobip delivery-report groupName to our lifecycle. */
function mapInfobipStatus(groupName: string): DeliveryStatus {
  const g = groupName.toUpperCase();
  if (g === "DELIVERED") return "delivered";
  if (g === "REJECTED" || g === "UNDELIVERABLE") return "failed";
  return "sent"; // PENDING / EXPIRED / unknown → in-flight
}

function results(payload: unknown): Record<string, unknown>[] {
  const p = asRecord(payload);
  return ((p.results as unknown[]) ?? []).map(asRecord);
}

abstract class InfobipConnector implements Channel {
  abstract readonly type: ChannelType;
  protected abstract sender(creds?: ChannelCredentials): string;
  protected abstract sendPath(): string;
  protected abstract sendBody(sender: string, to: string, text: string): Record<string, unknown>;

  verifyChallenge(): string | null {
    return null;
  }

  verifySignature(headers: Headers): boolean {
    const { webhookSecret } = infobipConfig();
    if (!webhookSecret) return false; // require a configured secret to accept inbound
    return safeEqual(headers.get("x-webhook-secret") ?? "", webhookSecret);
  }

  classifyEvent(payload: unknown): "message" | "status" {
    return results(payload).some((r) => r.status) ? "status" : "message";
  }

  accountRef(payload: unknown): string | null {
    const first = results(payload)[0];
    return first?.to ? String(first.to) : null;
  }

  normalizeWebhook(payload: unknown): NormalizedInbound[] {
    return results(payload)
      .filter((r) => !r.status) // skip DLRs
      .map((r) => {
        const message = r.message ? asRecord(r.message) : {};
        const text = String(message.text ?? r.text ?? r.cleanText ?? "");
        return {
          providerAccountId: r.to ? String(r.to) : null,
          body: text,
          externalMessageId: r.messageId ? String(r.messageId) : null,
          customer: {
            phone: r.from ? String(r.from) : null,
            externalId: r.from ? String(r.from) : null,
          },
        };
      });
  }

  normalizeStatus(payload: unknown): NormalizedStatus[] {
    const out: NormalizedStatus[] = [];
    for (const r of results(payload)) {
      if (!r.status || !r.messageId) continue;
      const status = asRecord(r.status);
      const groupName = String(status.groupName ?? status.name ?? "");
      const mapped = mapInfobipStatus(groupName);
      out.push({
        externalMessageId: String(r.messageId),
        status: mapped,
        error: mapped === "failed" ? String(status.description ?? groupName) : null,
      });
    }
    return out;
  }

  isConfigured(creds?: ChannelCredentials): boolean {
    const cfg = infobipConfig();
    return !!cfg.apiKey && !!this.sender(creds);
  }

  async sendMessage(to: string, body: string, creds?: ChannelCredentials) {
    const cfg = infobipConfig();
    const sender = this.sender(creds);
    if (!cfg.apiKey || !sender) throw new ConnectorError(`${this.type} is not configured`);
    const res = await fetch(`${cfg.baseUrl}${this.sendPath()}`, {
      method: "POST",
      headers: {
        authorization: `App ${cfg.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(this.sendBody(sender, to, body)),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new ConnectorError(`${this.type} send failed: ${res.status}`);
    }
    const messages = (json.messages as Record<string, unknown>[] | undefined) ?? [];
    return { externalMessageId: messages[0]?.messageId ? String(messages[0].messageId) : undefined };
  }
}

export class ViberConnector extends InfobipConnector {
  readonly type = "viber" as const;
  protected sender(creds?: ChannelCredentials) {
    return creds?.externalAccountId || infobipConfig().viberSender;
  }
  protected sendPath() {
    return "/viber/2/messages";
  }
  protected sendBody(sender: string, to: string, text: string) {
    return {
      messages: [
        { sender, destinations: [{ to }], content: { type: "TEXT", text } },
      ],
    };
  }
}

export class SmsConnector extends InfobipConnector {
  readonly type = "sms" as const;
  protected sender(creds?: ChannelCredentials) {
    return creds?.externalAccountId || infobipConfig().smsSender;
  }
  protected sendPath() {
    return "/sms/2/text/advanced";
  }
  protected sendBody(sender: string, to: string, text: string) {
    return { messages: [{ from: sender, destinations: [{ to }], text }] };
  }
}
