import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection } from "@prisma/client";
import { WhatsAppCloudAdapter, graphBaseUrl } from "@/lib/channels/whatsapp-adapter";

const adapter = new WhatsAppCloudAdapter();
const SECRET = "unit-test-app-secret";

function sign(rawBody: string, secret = SECRET): Headers {
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return new Headers({ "x-hub-signature-256": `sha256=${digest}` });
}

function webhook(value: Record<string, unknown>, phoneNumberId = "pn-1") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "+355" },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const textMessage = (over: Partial<Record<string, unknown>> = {}) =>
  webhook({
    contacts: [{ wa_id: "355691111", profile: { name: "Blerina" } }],
    messages: [
      {
        from: "355691111",
        id: "wamid.A1",
        timestamp: "1754131200",
        type: "text",
        text: { body: "Hello there" },
        ...over,
      },
    ],
  });

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", SECRET);
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-me");
});
afterEach(() => vi.unstubAllEnvs());

describe("whatsapp signature verification", () => {
  it("accepts a valid X-Hub-Signature-256 over the exact raw body", () => {
    const raw = JSON.stringify(textMessage());
    expect(adapter.verifySignature(sign(raw), raw, null)).toBe(true);
  });

  it("rejects a wrong secret, tampered body, malformed header, missing header", () => {
    const raw = JSON.stringify(textMessage());
    expect(adapter.verifySignature(sign(raw, "other-secret"), raw, null)).toBe(false);
    expect(adapter.verifySignature(sign(raw), raw + " ", null)).toBe(false);
    expect(
      adapter.verifySignature(new Headers({ "x-hub-signature-256": "zzz" }), raw, null),
    ).toBe(false);
    expect(adapter.verifySignature(new Headers(), raw, null)).toBe(false);
  });

  it("fails closed when the deployment secret is unset", () => {
    vi.stubEnv("META_APP_SECRET", "");
    const raw = JSON.stringify(textMessage());
    expect(adapter.verifySignature(sign(raw, ""), raw, null)).toBe(false);
  });
});

describe("whatsapp challenge handshake", () => {
  it("echoes the challenge only for a subscribe with the right token", () => {
    const good = new URL(
      "https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42",
    );
    expect(adapter.verifyChallenge(good)).toBe("42");
    const bad = new URL(
      "https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42",
    );
    expect(adapter.verifyChallenge(bad)).toBeNull();
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "");
    expect(adapter.verifyChallenge(good)).toBeNull();
  });
});

describe("whatsapp tenant routing", () => {
  it("resolves the RECEIVING number's phone_number_id, never the sender", () => {
    expect(adapter.connectionRef(textMessage())).toBe("pn-1");
  });

  it("rejects missing or ambiguous phone_number_ids and foreign payloads", () => {
    expect(adapter.connectionRef({ hostile: true })).toBeNull();
    const ambiguous = textMessage();
    ambiguous.entry.push(structuredClone(webhook({ messages: [] }, "pn-2").entry[0]));
    expect(adapter.connectionRef(ambiguous)).toBeNull();
    const noMeta = webhook({ messages: [] });
    delete (noMeta.entry[0].changes[0].value as { metadata?: unknown }).metadata;
    expect(adapter.connectionRef(noMeta)).toBeNull();
  });
});

describe("whatsapp normalization", () => {
  it("normalizes a text message with wa: identity and epoch timestamp", () => {
    const [event] = adapter.receiveEvents(textMessage());
    expect(event).toMatchObject({
      kind: "message",
      providerThreadId: "355691111",
      providerMessageId: "wamid.A1",
      sender: { externalId: "wa:355691111", displayName: "Blerina", email: null },
      body: "Hello there",
      media: null,
    });
    expect((event as { providerTimestamp: Date }).providerTimestamp.toISOString()).toBe(
      "2025-08-02T10:40:00.000Z",
    );
  });

  it("media becomes safe metadata in a pending state — no URLs, no tokens", () => {
    const payload = webhook({
      contacts: [{ wa_id: "355691111", profile: { name: "B" } }],
      messages: [
        {
          from: "355691111",
          id: "wamid.M1",
          timestamp: "1754131200",
          type: "document",
          document: { id: "media-9", mime_type: "application/pdf", filename: "plan.pdf" },
        },
      ],
    });
    const [event] = adapter.receiveEvents(payload);
    expect(event).toMatchObject({
      body: "",
      media: {
        pending: true,
        kind: "document",
        providerMediaId: "media-9",
        mimeType: "application/pdf",
        filename: "plan.pdf",
      },
    });
    expect(JSON.stringify(event)).not.toContain("http");
  });

  it("unsupported types (stickers, reactions) are not projected", () => {
    const payload = webhook({
      messages: [
        { from: "1", id: "wamid.S1", type: "sticker", sticker: { id: "st-1" } },
        { from: "1", id: "wamid.R1", type: "reaction", reaction: { emoji: "👍" } },
      ],
    });
    expect(adapter.receiveEvents(payload)).toEqual([]);
    expect(adapter.classifyEvent(payload)).toBe("message");
  });

  it("normalizes delivery statuses with error reduced to code+title", () => {
    const payload = webhook({
      statuses: [
        { id: "wamid.A1", status: "delivered" },
        { id: "wamid.A2", status: "failed", errors: [{ code: 131047, title: "Re-engagement required" }] },
        { id: "wamid.A3", status: "weird" },
      ],
    });
    expect(adapter.classifyEvent(payload)).toBe("status");
    const events = adapter.receiveEvents(payload);
    expect(events).toEqual([
      {
        kind: "status",
        providerMessageId: "wamid.A1",
        deliveryStatus: "DELIVERED",
        errorMessage: null,
      },
      {
        kind: "status",
        providerMessageId: "wamid.A2",
        deliveryStatus: "FAILED",
        errorMessage: "provider_error 131047: Re-engagement required",
      },
    ]);
  });

  it("dedupe key is deterministic and order-independent", () => {
    const a = adapter.dedupeKey(
      webhook({ statuses: [{ id: "w1", status: "sent" }, { id: "w2", status: "read" }] }),
    );
    const b = adapter.dedupeKey(
      webhook({ statuses: [{ id: "w2", status: "read" }, { id: "w1", status: "sent" }] }),
    );
    expect(a).toBe(b);
    expect(adapter.dedupeKey(webhook({ messages: [], statuses: [] }))).toBeNull();
    expect(adapter.dedupeKey({ hostile: true })).toBeNull();
  });
});

describe("whatsapp graph host guard", () => {
  it("honours META_GRAPH_BASE_URL outside production only", () => {
    vi.stubEnv("META_GRAPH_BASE_URL", "http://127.0.0.1:4545");
    vi.stubEnv("OPERANTO_ENV", "test");
    expect(graphBaseUrl()).toBe("http://127.0.0.1:4545");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OPERANTO_ENV", "");
    expect(graphBaseUrl()).toBe("https://graph.facebook.com");
  });
});

describe("whatsapp send preconditions", () => {
  it("refuses a connection without routing identity or credential", async () => {
    await expect(
      adapter.sendMessage({
        connection: { phoneNumberId: null, accessTokenEncrypted: null } as ChannelConnection,
        providerThreadId: null,
        recipientExternalId: "wa:355691111",
        body: "x",
      }),
    ).rejects.toThrow(/not send-capable/);
  });
});
