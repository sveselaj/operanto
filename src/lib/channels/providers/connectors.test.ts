import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { WhatsAppConnector, MessengerConnector, InstagramConnector } from "./meta";
import { TelegramConnector } from "./telegram";
import { ViberConnector, SmsConnector } from "./infobip";

const CONNECTOR_ENV = [
  "META_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "INFOBIP_WEBHOOK_SECRET",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of CONNECTOR_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of CONNECTOR_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("WhatsAppConnector", () => {
  const wa = new WhatsAppConnector();
  const inbound = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551234", phone_number_id: "PNID1" },
              contacts: [{ profile: { name: "Sara" }, wa_id: "38344123456" }],
              messages: [
                { from: "38344123456", id: "wamid.1", timestamp: "170", type: "text", text: { body: "Hi" } },
              ],
            },
          },
        ],
      },
    ],
  };

  it("classifies + resolves account + normalizes an inbound message", () => {
    expect(wa.classifyEvent(inbound)).toBe("message");
    expect(wa.accountRef(inbound)).toBe("PNID1");
    expect(wa.normalizeWebhook(inbound)).toEqual([
      {
        providerAccountId: "PNID1",
        body: "Hi",
        externalMessageId: "wamid.1",
        customer: { name: "Sara", phone: "38344123456", externalId: "38344123456" },
      },
    ]);
  });

  it("labels non-text messages by type", () => {
    const img = structuredClone(inbound);
    img.entry[0].changes[0].value.messages[0] = {
      from: "38344123456",
      id: "wamid.2",
      timestamp: "171",
      type: "image",
    } as never;
    expect(wa.normalizeWebhook(img)[0].body).toBe("[image]");
  });

  it("classifies + normalizes delivery statuses", () => {
    const status = {
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "read", recipient_id: "x" }] } }] }],
    };
    expect(wa.classifyEvent(status)).toBe("status");
    expect(wa.normalizeStatus(status)).toEqual([{ externalMessageId: "wamid.1", status: "read", error: null }]);
  });

  it("verifies X-Hub-Signature-256 against META_APP_SECRET", () => {
    process.env.META_APP_SECRET = "s3cr3t";
    const raw = JSON.stringify(inbound);
    const sig = "sha256=" + createHmac("sha256", "s3cr3t").update(raw, "utf8").digest("hex");
    expect(wa.verifySignature(new Headers({ "x-hub-signature-256": sig }), raw)).toBe(true);
    expect(wa.verifySignature(new Headers({ "x-hub-signature-256": "sha256=deadbeef" }), raw)).toBe(false);
  });

  it("rejects when no app secret is configured", () => {
    expect(wa.verifySignature(new Headers({ "x-hub-signature-256": "sha256=x" }), "{}")).toBe(false);
  });

  it("answers the GET verify handshake", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "VT";
    const ok = new URL("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=VT&hub.challenge=CH");
    expect(wa.verifyChallenge(ok)).toBe("CH");
    const bad = new URL("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=NOPE&hub.challenge=CH");
    expect(wa.verifyChallenge(bad)).toBeNull();
  });

  it("reports configured only with token + phone number id", () => {
    expect(wa.isConfigured()).toBe(false);
    expect(wa.isConfigured({ accessToken: "t", externalAccountId: "PNID" })).toBe(true);
    expect(wa.isConfigured({ accessToken: "t" })).toBe(false);
  });
});

describe("MessengerConnector", () => {
  const fb = new MessengerConnector();
  const inbound = {
    object: "page",
    entry: [
      {
        id: "PAGEID",
        messaging: [{ sender: { id: "PSID" }, recipient: { id: "PAGEID" }, message: { mid: "m.1", text: "Hello" } }],
      },
    ],
  };

  it("normalizes a Messenger inbound message", () => {
    expect(fb.accountRef(inbound)).toBe("PAGEID");
    expect(fb.normalizeWebhook(inbound)).toEqual([
      {
        providerAccountId: "PAGEID",
        body: "Hello",
        externalMessageId: "m.1",
        customer: { externalId: "PSID", handle: "PSID" },
      },
    ]);
  });

  it("maps delivery receipts to delivered for each mid", () => {
    const delivery = { entry: [{ id: "PAGEID", messaging: [{ delivery: { mids: ["m.1", "m.2"] } }] }] };
    expect(fb.classifyEvent(delivery)).toBe("status");
    expect(fb.normalizeStatus(delivery)).toEqual([
      { externalMessageId: "m.1", status: "delivered" },
      { externalMessageId: "m.2", status: "delivered" },
    ]);
  });
});

describe("InstagramConnector", () => {
  it("normalizes an IG inbound message and never reports status", () => {
    const ig = new InstagramConnector();
    const inbound = {
      object: "instagram",
      entry: [{ id: "IGID", messaging: [{ sender: { id: "IGSID" }, message: { mid: "ig.1", text: "yo" } }] }],
    };
    expect(ig.accountRef(inbound)).toBe("IGID");
    expect(ig.normalizeWebhook(inbound)[0]).toMatchObject({
      providerAccountId: "IGID",
      body: "yo",
      externalMessageId: "ig.1",
      customer: { externalId: "IGSID" },
    });
    expect(ig.classifyEvent()).toBe("message");
    expect(ig.normalizeStatus()).toEqual([]);
  });
});

describe("TelegramConnector", () => {
  const tg = new TelegramConnector();
  const update = {
    update_id: 10,
    message: { message_id: 5, from: { id: 1, first_name: "Ben", username: "ben" }, chat: { id: 999 }, text: "yo" },
  };

  it("normalizes an update with chat id as the send target", () => {
    expect(tg.normalizeWebhook(update)).toEqual([
      { body: "yo", externalMessageId: "5", customer: { name: "Ben", handle: "ben", externalId: "999" } },
    ]);
  });

  it("verifies the secret-token header", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "tsecret";
    expect(tg.verifySignature(new Headers({ "x-telegram-bot-api-secret-token": "tsecret" }))).toBe(true);
    expect(tg.verifySignature(new Headers({ "x-telegram-bot-api-secret-token": "nope" }))).toBe(false);
  });

  it("rejects when no webhook secret is configured", () => {
    expect(tg.verifySignature(new Headers({ "x-telegram-bot-api-secret-token": "x" }))).toBe(false);
  });
});

describe("Infobip connectors", () => {
  it("Viber normalizes inbound + maps delivery statuses", () => {
    const vb = new ViberConnector();
    const inbound = { results: [{ messageId: "vmid", from: "38344", to: "pa:viberpa", message: { text: "hey" } }] };
    expect(vb.accountRef(inbound)).toBe("pa:viberpa");
    expect(vb.normalizeWebhook(inbound)).toEqual([
      {
        providerAccountId: "pa:viberpa",
        body: "hey",
        externalMessageId: "vmid",
        customer: { phone: "38344", externalId: "38344" },
      },
    ]);
    const dlr = { results: [{ messageId: "vmid", to: "x", status: { groupName: "DELIVERED" } }] };
    expect(vb.classifyEvent(dlr)).toBe("status");
    expect(vb.normalizeStatus(dlr)).toEqual([{ externalMessageId: "vmid", status: "delivered", error: null }]);
    const rejected = { results: [{ messageId: "v2", status: { groupName: "REJECTED", description: "blocked" } }] };
    expect(vb.normalizeStatus(rejected)[0]).toMatchObject({ status: "failed", error: "blocked" });
  });

  it("SMS reads text from the MO payload", () => {
    const sms = new SmsConnector();
    const inbound = { results: [{ messageId: "smid", from: "38344", to: "SENDER", text: "sms hi" }] };
    expect(sms.normalizeWebhook(inbound)[0]).toMatchObject({ body: "sms hi", externalMessageId: "smid" });
  });

  it("verifies the X-Webhook-Secret header", () => {
    process.env.INFOBIP_WEBHOOK_SECRET = "ibsecret";
    const vb = new ViberConnector();
    expect(vb.verifySignature(new Headers({ "x-webhook-secret": "ibsecret" }))).toBe(true);
    expect(vb.verifySignature(new Headers({ "x-webhook-secret": "nope" }))).toBe(false);
  });
});
