import type { ChannelType } from "@prisma/client";
import {
  asRecord,
  isDeliveryStatus,
  hmacSha256Hex,
  safeEqual,
  ConnectorError,
  type Channel,
  type ChannelCredentials,
  type NormalizedInbound,
  type NormalizedStatus,
} from "../types";
import {
  metaConfig,
  whatsappConfig,
  messengerConfig,
  instagramConfig,
} from "../config";

/**
 * Meta Graph connectors — WhatsApp Cloud API, Messenger, Instagram.
 *
 * Shared: the GET subscribe handshake (hub.* params), X-Hub-Signature-256
 * HMAC-SHA256 verification keyed by the Meta app secret, and Graph API sends.
 * Contracts mirror MediaSyncHub (graph v22.0).
 */

type GraphPostOptions = { token: string; useQueryToken?: boolean };

abstract class MetaConnector implements Channel {
  abstract readonly type: ChannelType;
  protected abstract verifyToken(): string;

  verifyChallenge(url: URL): string | null {
    const sp = url.searchParams;
    const token = this.verifyToken();
    if (sp.get("hub.mode") === "subscribe" && token && sp.get("hub.verify_token") === token) {
      return sp.get("hub.challenge") ?? "";
    }
    return null;
  }

  verifySignature(headers: Headers, rawBody: string): boolean {
    const { appSecret } = metaConfig();
    if (!appSecret) return false; // cannot verify without the app secret
    const header = headers.get("x-hub-signature-256");
    if (!header?.startsWith("sha256=")) return false;
    return safeEqual(header.slice("sha256=".length), hmacSha256Hex(appSecret, rawBody));
  }

  abstract classifyEvent(payload: unknown): "message" | "status";
  abstract accountRef(payload: unknown): string | null;
  abstract normalizeWebhook(payload: unknown): NormalizedInbound[];
  abstract normalizeStatus(payload: unknown): NormalizedStatus[];
  abstract sendMessage(
    to: string,
    body: string,
    creds?: ChannelCredentials,
  ): Promise<{ externalMessageId?: string }>;
  abstract isConfigured(creds?: ChannelCredentials): boolean;

  protected async graphPost(
    path: string,
    body: Record<string, unknown>,
    { token, useQueryToken }: GraphPostOptions,
  ): Promise<Record<string, unknown>> {
    const { graphVersion } = metaConfig();
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (useQueryToken) url.searchParams.set("access_token", token);
    else headers["authorization"] = `Bearer ${token}`;

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error as Record<string, unknown> | undefined)?.message;
      throw new ConnectorError(`${this.type} send failed: ${err ?? res.status}`);
    }
    return json;
  }
}

/** Iterate the messaging[] entries of a Messenger/Instagram payload. */
function messagingEntries(payload: unknown): { entryId: string; m: Record<string, unknown> }[] {
  const p = asRecord(payload);
  const out: { entryId: string; m: Record<string, unknown> }[] = [];
  for (const e of (p.entry as unknown[]) ?? []) {
    const entry = asRecord(e);
    const entryId = String(entry.id ?? "");
    for (const msg of (entry.messaging as unknown[]) ?? []) {
      out.push({ entryId, m: asRecord(msg) });
    }
  }
  return out;
}

// ── WhatsApp Cloud API ──────────────────────────────────────────

export class WhatsAppConnector extends MetaConnector {
  readonly type = "whatsapp" as const;
  protected verifyToken() {
    return whatsappConfig().verifyToken;
  }

  private values(payload: unknown): Record<string, unknown>[] {
    const p = asRecord(payload);
    const values: Record<string, unknown>[] = [];
    for (const e of (p.entry as unknown[]) ?? []) {
      for (const ch of (asRecord(e).changes as unknown[]) ?? []) {
        const v = asRecord(ch).value;
        if (v) values.push(asRecord(v));
      }
    }
    return values;
  }

  classifyEvent(payload: unknown): "message" | "status" {
    return this.values(payload).some((v) => Array.isArray(v.statuses)) ? "status" : "message";
  }

  accountRef(payload: unknown): string | null {
    for (const v of this.values(payload)) {
      const meta = v.metadata ? asRecord(v.metadata) : null;
      if (meta?.phone_number_id) return String(meta.phone_number_id);
    }
    return null;
  }

  normalizeWebhook(payload: unknown): NormalizedInbound[] {
    const out: NormalizedInbound[] = [];
    for (const v of this.values(payload)) {
      const meta = v.metadata ? asRecord(v.metadata) : {};
      const providerAccountId = meta.phone_number_id ? String(meta.phone_number_id) : null;
      const contacts = (v.contacts as unknown[]) ?? [];
      const profileName = contacts.length
        ? (asRecord(asRecord(contacts[0]).profile ?? {}).name as string | undefined)
        : undefined;
      for (const msg of (v.messages as unknown[]) ?? []) {
        const m = asRecord(msg);
        const type = String(m.type ?? "text");
        const body =
          type === "text" ? String(asRecord(m.text ?? {}).body ?? "") : `[${type}]`;
        out.push({
          providerAccountId,
          body,
          externalMessageId: m.id ? String(m.id) : null,
          customer: {
            name: profileName ?? null,
            phone: m.from ? String(m.from) : null,
            externalId: m.from ? String(m.from) : null,
          },
        });
      }
    }
    return out;
  }

  normalizeStatus(payload: unknown): NormalizedStatus[] {
    const out: NormalizedStatus[] = [];
    for (const v of this.values(payload)) {
      for (const st of (v.statuses as unknown[]) ?? []) {
        const s = asRecord(st);
        const status = String(s.status ?? "");
        if (!s.id || !isDeliveryStatus(status)) continue;
        const errors = (s.errors as unknown[]) ?? [];
        const error = errors.length ? String(asRecord(errors[0]).title ?? "Failed") : null;
        out.push({ externalMessageId: String(s.id), status, error });
      }
    }
    return out;
  }

  isConfigured(creds?: ChannelCredentials): boolean {
    const cfg = whatsappConfig();
    return !!(creds?.accessToken || cfg.accessToken) && !!(creds?.externalAccountId || cfg.phoneNumberId);
  }

  async sendMessage(to: string, body: string, creds?: ChannelCredentials) {
    const cfg = whatsappConfig();
    const phoneNumberId = creds?.externalAccountId || cfg.phoneNumberId;
    const token = creds?.accessToken || cfg.accessToken;
    if (!phoneNumberId || !token) throw new ConnectorError("WhatsApp is not configured");
    const json = await this.graphPost(
      `${phoneNumberId}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      { token },
    );
    const messages = (json.messages as Record<string, unknown>[] | undefined) ?? [];
    return { externalMessageId: messages[0]?.id ? String(messages[0].id) : undefined };
  }
}

// ── Messenger (Facebook Pages) ──────────────────────────────────

export class MessengerConnector extends MetaConnector {
  readonly type = "facebook" as const;
  protected verifyToken() {
    return messengerConfig().verifyToken;
  }

  classifyEvent(payload: unknown): "message" | "status" {
    return messagingEntries(payload).some((e) => e.m.delivery || e.m.read) ? "status" : "message";
  }

  accountRef(payload: unknown): string | null {
    const entries = messagingEntries(payload);
    return entries.length ? entries[0].entryId || null : null;
  }

  normalizeWebhook(payload: unknown): NormalizedInbound[] {
    const out: NormalizedInbound[] = [];
    for (const { entryId, m } of messagingEntries(payload)) {
      const message = m.message ? asRecord(m.message) : null;
      if (!message) continue;
      const sender = m.sender ? asRecord(m.sender) : {};
      const senderId = sender.id ? String(sender.id) : null;
      const text = message.text ? String(message.text) : "[attachment]";
      out.push({
        providerAccountId: entryId || null,
        body: text,
        externalMessageId: message.mid ? String(message.mid) : null,
        customer: { externalId: senderId, handle: senderId },
      });
    }
    return out;
  }

  normalizeStatus(payload: unknown): NormalizedStatus[] {
    const out: NormalizedStatus[] = [];
    for (const { m } of messagingEntries(payload)) {
      const delivery = m.delivery ? asRecord(m.delivery) : null;
      for (const mid of (delivery?.mids as unknown[]) ?? []) {
        out.push({ externalMessageId: String(mid), status: "delivered" });
      }
    }
    return out;
  }

  isConfigured(creds?: ChannelCredentials): boolean {
    return !!(creds?.accessToken || messengerConfig().accessToken);
  }

  async sendMessage(to: string, body: string, creds?: ChannelCredentials) {
    const token = creds?.accessToken || messengerConfig().accessToken;
    if (!token) throw new ConnectorError("Messenger is not configured");
    const json = await this.graphPost(
      "me/messages",
      { recipient: { id: to }, messaging_type: "RESPONSE", message: { text: body } },
      { token, useQueryToken: true },
    );
    return { externalMessageId: json.message_id ? String(json.message_id) : undefined };
  }
}

// ── Instagram messaging ─────────────────────────────────────────

export class InstagramConnector extends MetaConnector {
  readonly type = "instagram" as const;
  protected verifyToken() {
    return instagramConfig().verifyToken;
  }

  classifyEvent(): "message" | "status" {
    return "message"; // Instagram does not deliver status webhooks
  }

  accountRef(payload: unknown): string | null {
    const entries = messagingEntries(payload);
    return entries.length ? entries[0].entryId || null : null;
  }

  normalizeWebhook(payload: unknown): NormalizedInbound[] {
    const out: NormalizedInbound[] = [];
    for (const { entryId, m } of messagingEntries(payload)) {
      const message = m.message ? asRecord(m.message) : null;
      if (!message) continue;
      const sender = m.sender ? asRecord(m.sender) : {};
      const senderId = sender.id ? String(sender.id) : null;
      const text = message.text ? String(message.text) : "[attachment]";
      const mid = message.mid ?? message.id;
      out.push({
        providerAccountId: entryId || null,
        body: text,
        externalMessageId: mid ? String(mid) : null,
        customer: { externalId: senderId, handle: senderId },
      });
    }
    return out;
  }

  normalizeStatus(): NormalizedStatus[] {
    return [];
  }

  isConfigured(creds?: ChannelCredentials): boolean {
    return !!(creds?.accessToken || instagramConfig().accessToken);
  }

  async sendMessage(to: string, body: string, creds?: ChannelCredentials) {
    const token = creds?.accessToken || instagramConfig().accessToken;
    if (!token) throw new ConnectorError("Instagram is not configured");
    const json = await this.graphPost(
      "me/messages",
      { recipient: { id: to }, message: { text: body } },
      { token, useQueryToken: true },
    );
    return { externalMessageId: json.message_id ? String(json.message_id) : undefined };
  }
}
