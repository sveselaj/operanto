import {
  asRecord,
  safeEqual,
  ConnectorError,
  type Channel,
  type ChannelCredentials,
  type NormalizedInbound,
  type NormalizedStatus,
} from "../types";
import { telegramConfig } from "../config";

/**
 * Telegram Bot API connector.
 *
 * Inbound updates are POSTed to the webhook; verification is the
 * X-Telegram-Bot-Api-Secret-Token header (set via setWebhook) matched against
 * TELEGRAM_WEBHOOK_SECRET. Telegram emits no delivery-status webhooks.
 */
export class TelegramConnector implements Channel {
  readonly type = "telegram" as const;

  verifyChallenge(): string | null {
    return null;
  }

  verifySignature(headers: Headers): boolean {
    const { webhookSecret } = telegramConfig();
    if (!webhookSecret) return false; // require a configured secret to accept inbound
    return safeEqual(headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret);
  }

  classifyEvent(): "message" | "status" {
    return "message";
  }

  // Single bot per deployment — let the route fall back to matching by channel type.
  accountRef(): string | null {
    return null;
  }

  normalizeWebhook(payload: unknown): NormalizedInbound[] {
    const p = asRecord(payload);
    const msg = p.message ?? p.edited_message;
    if (!msg) return [];
    const m = asRecord(msg);
    const chat = m.chat ? asRecord(m.chat) : {};
    const from = m.from ? asRecord(m.from) : {};
    const chatId = chat.id != null ? String(chat.id) : null;
    const text = m.text ? String(m.text) : "[non-text message]";
    return [
      {
        body: text,
        externalMessageId: m.message_id != null ? String(m.message_id) : null,
        customer: {
          name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
          handle: from.username ? String(from.username) : null,
          externalId: chatId, // chat id is the send target
        },
      },
    ];
  }

  normalizeStatus(): NormalizedStatus[] {
    return [];
  }

  isConfigured(creds?: ChannelCredentials): boolean {
    return !!(creds?.accessToken || telegramConfig().botToken);
  }

  async sendMessage(to: string, body: string, creds?: ChannelCredentials) {
    const token = creds?.accessToken || telegramConfig().botToken;
    if (!token) throw new ConnectorError("Telegram is not configured");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: to, text: body }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok === false) {
      throw new ConnectorError(`Telegram send failed: ${json.description ?? res.status}`);
    }
    const result = json.result ? asRecord(json.result) : {};
    return { externalMessageId: result.message_id != null ? String(result.message_id) : undefined };
  }
}
