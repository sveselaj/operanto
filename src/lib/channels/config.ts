/**
 * Provider configuration for the live channel connectors.
 *
 * App-level secrets come from env (one Meta app, one Infobip account, one bot
 * per deployment); per-account send credentials (phone number id, page token,
 * sender) can also come from the ChannelAccount and override these. Read lazily
 * so tests and runtime can set env freely.
 */

const env = (...keys: string[]): string => {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return "";
};

/** Meta Graph (shared by WhatsApp, Messenger, Instagram). */
export const metaConfig = () => ({
  appSecret: env("META_APP_SECRET", "FACEBOOK_APP_SECRET"),
  graphVersion: env("META_GRAPH_VERSION") || "v22.0",
});

export const whatsappConfig = () => ({
  verifyToken: env("WHATSAPP_VERIFY_TOKEN", "WA_VERIFY_TOKEN"),
  phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID", "WA_PHONE_NUMBER_ID"),
  accessToken: env("WHATSAPP_ACCESS_TOKEN", "WA_ACCESS_TOKEN"),
});

export const messengerConfig = () => ({
  verifyToken: env("FACEBOOK_VERIFY_TOKEN", "MESSENGER_VERIFY_TOKEN"),
  pageId: env("FACEBOOK_PAGE_ID"),
  accessToken: env("FACEBOOK_ACCESS_TOKEN", "FACEBOOK_PAGE_TOKEN"),
});

export const instagramConfig = () => ({
  verifyToken: env("INSTAGRAM_VERIFY_TOKEN"),
  userId: env("INSTAGRAM_USER_ID"),
  accessToken: env("INSTAGRAM_ACCESS_TOKEN"),
});

export const telegramConfig = () => ({
  botToken: env("TELEGRAM_BOT_TOKEN"),
  webhookSecret: env("TELEGRAM_WEBHOOK_SECRET"),
});

export const infobipConfig = () => ({
  apiKey: env("INFOBIP_API_KEY"),
  baseUrl: (env("INFOBIP_BASE_URL") || "https://api.infobip.com").replace(/\/+$/, ""),
  webhookSecret: env("INFOBIP_WEBHOOK_SECRET", "WEBHOOK_SECRET"),
  smsSender: env("SMS_SENDER"),
  viberSender: env("VIBER_SENDER_ID", "VIBER_SENDER"),
});
