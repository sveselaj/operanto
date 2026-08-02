import { createHmac } from "node:crypto";
import type { ChannelConnection } from "@prisma/client";
import { decryptSecret, safeEqual } from "@/lib/crypto";
import { deploymentEnvironment } from "@/lib/rate-limit";
import {
  ChannelAdapterError,
  type ConnectionStatus,
  type ConversationChannelAdapter,
  type NormalizedChannelEvent,
  type NormalizedInboundMessage,
  type SendMessageInput,
  type SendMessageResult,
} from "@/lib/channels/types";

/**
 * WhatsApp Cloud adapter (Slice 5B) — one Operanto-managed Meta application,
 * per-organisation WABAs and phone numbers.
 *
 * Security posture:
 * - signature verification uses the DEPLOYMENT-LEVEL app secret
 *   (META_APP_SECRET) because the Meta application is Operanto-managed; it
 *   runs BEFORE any tenant resolution or payload parsing;
 * - the tenant key is `value.metadata.phone_number_id` — Meta's authoritative
 *   identifier for the receiving number, globally unique and enforced unique
 *   on ChannelConnection. The SENDER's phone number is never a tenant key;
 * - a payload naming more than one phone_number_id is ambiguous and rejected;
 * - per-organisation access tokens are AES-256-GCM ciphertext and decrypted
 *   only inside the send/verify calls, never returned or logged;
 * - provider error bodies are reduced to code+type — response bodies may echo
 *   recipient details and are never logged or persisted;
 * - META_GRAPH_BASE_URL overrides the Graph host for tests/staging sandboxes
 *   ONLY outside production — production always uses graph.facebook.com.
 *
 * Media policy (first release): text is projected fully; image, document,
 * audio and video messages persist SAFE METADATA ONLY (provider media id,
 * mime type, filename, caption) in a visible `media_pending` state — binary
 * retrieval is deliberately deferred. Stickers, reactions and other types are
 * not projected. Provider media URLs and tokens are never stored.
 */

const GRAPH_VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
const SEND_TIMEOUT_MS = 15_000;

export function graphBaseUrl(): string {
  const override = process.env.META_GRAPH_BASE_URL;
  if (override && deploymentEnvironment() !== "production") return override;
  return "https://graph.facebook.com";
}

type WaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  document?: WaMedia & { filename?: string };
  audio?: WaMedia;
  video?: WaMedia;
  location?: { latitude?: number; longitude?: number; name?: string };
};
type WaMedia = { id?: string; mime_type?: string; caption?: string };
type WaStatus = {
  id?: string;
  status?: string;
  errors?: Array<{ code?: number; title?: string }>;
};
type WaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WaMessage[];
  statuses?: WaStatus[];
};

const MEDIA_KINDS = ["image", "document", "audio", "video"] as const;

function values(payload: unknown): WaValue[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as {
    object?: string;
    entry?: Array<{ changes?: Array<{ field?: string; value?: WaValue }> }>;
  };
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) {
    return [];
  }
  const out: WaValue[] = [];
  for (const entry of root.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field === "messages" && change.value) out.push(change.value);
    }
  }
  return out;
}

function normalizeMessage(value: WaValue, message: WaMessage): NormalizedInboundMessage | null {
  if (!message.from || !message.id) return null;
  const contact = (value.contacts ?? []).find((c) => c.wa_id === message.from);
  const timestampSeconds = Number(message.timestamp);
  const base = {
    kind: "message" as const,
    providerThreadId: message.from,
    providerMessageId: message.id,
    providerTimestamp: Number.isFinite(timestampSeconds)
      ? new Date(timestampSeconds * 1000)
      : null,
    sender: {
      externalId: `wa:${message.from}`,
      displayName: contact?.profile?.name ?? null,
      email: null,
    },
    subject: null,
    media: null as NormalizedInboundMessage["media"],
  };
  if (message.type === "text") {
    const body = message.text?.body;
    if (typeof body !== "string" || body.length === 0) return null;
    return { ...base, body };
  }
  if (message.type === "location" && message.location) {
    const { latitude, longitude, name } = message.location;
    return {
      ...base,
      body: `Location shared: ${name ? `${name} — ` : ""}${latitude}, ${longitude}`,
    };
  }
  if (MEDIA_KINDS.includes(message.type as (typeof MEDIA_KINDS)[number])) {
    const media = message[message.type as (typeof MEDIA_KINDS)[number]];
    if (!media?.id) return null;
    return {
      ...base,
      body: media.caption ?? "",
      media: {
        pending: true,
        kind: message.type as string,
        providerMediaId: media.id,
        mimeType: media.mime_type ?? null,
        filename:
          message.type === "document" ? (message.document?.filename ?? null) : null,
      },
    };
  }
  // Stickers, reactions, interactive payloads etc. are documented-unsupported
  // in this release and deliberately not projected.
  return null;
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export class WhatsAppCloudAdapter implements ConversationChannelAdapter {
  readonly type = "WHATSAPP" as const;

  /** Meta subscription handshake — token compared timing-safe, fail closed. */
  verifyChallenge(url: URL): string | null {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!expected) return null;
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !token || !challenge) return null;
    return safeEqual(token, expected) ? challenge : null;
  }

  /**
   * X-Hub-Signature-256 over the raw body with the Operanto-managed app
   * secret. Runs before tenant resolution, so `connection` is null here.
   */
  verifySignature(
    headers: Headers,
    rawBody: string,
    // Deployment-level secret — the connection is deliberately unused.
    _connection: ChannelConnection | null, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return false;
    const header = headers.get("x-hub-signature-256");
    if (!header?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    return safeEqual(header.slice("sha256=".length), expected);
  }

  classifyEvent(payload: unknown): "message" | "status" | "ignore" {
    const all = values(payload);
    if (all.some((v) => (v.messages?.length ?? 0) > 0)) return "message";
    if (all.some((v) => (v.statuses?.length ?? 0) > 0)) return "status";
    return "ignore";
  }

  /** The receiving number's phone_number_id; ambiguity is a rejection. */
  connectionRef(payload: unknown): string | null {
    const ids = new Set(
      values(payload)
        .map((v) => v.metadata?.phone_number_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    if (ids.size !== 1) return null;
    return [...ids][0];
  }

  dedupeKey(payload: unknown): string | null {
    const parts: string[] = [];
    for (const value of values(payload)) {
      for (const message of value.messages ?? []) {
        if (message.id) parts.push(`m:${message.id}`);
      }
      for (const status of value.statuses ?? []) {
        if (status.id && status.status) parts.push(`s:${status.id}:${status.status}`);
      }
    }
    if (parts.length === 0) return null;
    return `wa:${parts.sort().join("|")}`;
  }

  receiveEvents(payload: unknown): NormalizedChannelEvent[] {
    const events: NormalizedChannelEvent[] = [];
    for (const value of values(payload)) {
      for (const message of value.messages ?? []) {
        const normalized = normalizeMessage(value, message);
        if (normalized) events.push(normalized);
      }
      for (const status of value.statuses ?? []) {
        const mapped = status.status ? STATUS_MAP[status.status] : undefined;
        if (!status.id || !mapped) continue;
        const firstError = status.errors?.[0];
        events.push({
          kind: "status",
          providerMessageId: status.id,
          deliveryStatus: mapped,
          errorMessage:
            mapped === "FAILED"
              ? `provider_error ${firstError?.code ?? "unknown"}: ${firstError?.title ?? "send failed"}`
              : null,
        });
      }
    }
    return events;
  }

  /**
   * Explicit outbound transmission (Stage B). Only ever invoked by the
   * sendWhatsAppMessage service operation after its full recheck chain — no
   * background process, AI approval or worker calls this.
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const { connection } = input;
    if (!connection.phoneNumberId || !connection.accessTokenEncrypted) {
      throw new ChannelAdapterError("whatsapp connection is not send-capable");
    }
    const token = decryptSecret(connection.accessTokenEncrypted);
    const recipient = input.recipientExternalId.replace(/^wa:/, "");
    const body = input.template
      ? {
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: input.template.name,
            language: { code: input.template.language },
          },
        }
      : {
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body: input.body },
        };

    const response = await fetch(
      `${graphBaseUrl()}/${GRAPH_VERSION()}/${connection.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    ).catch((error: unknown) => {
      throw new ChannelAdapterError(
        error instanceof Error && error.name === "TimeoutError"
          ? "provider_timeout"
          : "provider_unreachable",
      );
    });

    if (!response.ok) {
      // Reduce provider errors to code+type — bodies may echo recipient
      // details and are never logged or persisted.
      const detail = await response
        .json()
        .then((data: { error?: { code?: number; type?: string } }) =>
          data?.error ? `${data.error.type ?? "error"} ${data.error.code ?? ""}`.trim() : null,
        )
        .catch(() => null);
      throw new ChannelAdapterError(
        `provider_rejected status=${response.status}${detail ? ` ${detail}` : ""}`,
      );
    }
    const result = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
    } | null;
    const providerMessageId = result?.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new ChannelAdapterError("provider_response_missing_message_id");
    }
    return { providerMessageId };
  }

  /** Reads the phone number resource — proves token + number ownership. */
  async verifyConnection(connection: ChannelConnection): Promise<ConnectionStatus> {
    if (!connection.phoneNumberId || !connection.accessTokenEncrypted) {
      return { healthy: false, detail: "missing phone number id or access token" };
    }
    let token: string;
    try {
      token = decryptSecret(connection.accessTokenEncrypted);
    } catch {
      return { healthy: false, detail: "stored credential cannot be decrypted" };
    }
    try {
      const response = await fetch(
        `${graphBaseUrl()}/${GRAPH_VERSION()}/${connection.phoneNumberId}?fields=display_phone_number`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        return { healthy: false, detail: `provider_status_${response.status}` };
      }
      return { healthy: true, detail: null };
    } catch {
      return { healthy: false, detail: "provider_unreachable" };
    }
  }
}
