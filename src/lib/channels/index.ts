import type { ChannelType } from "@prisma/client";
import type { Channel } from "./types";
import { DirectConnector } from "./providers/direct";
import { WhatsAppConnector, MessengerConnector, InstagramConnector } from "./providers/meta";
import { TelegramConnector } from "./providers/telegram";
import { ViberConnector, SmsConnector } from "./providers/infobip";
import { UnconfiguredConnector } from "./providers/unconfigured";

/**
 * Channel connector registry — the MediaSync communication layer's edge.
 *
 * Web chat / manual use the credential-free DirectConnector. The provider
 * connectors (WhatsApp, Messenger, Instagram, Telegram, Viber, SMS) implement
 * the full Channel contract — signature verification, webhook normalization,
 * delivery status, and sending — and degrade gracefully (reject inbound, refuse
 * to send) until their env/account credentials are configured.
 */

export * from "./types";

const REGISTRY: Record<ChannelType, Channel> = {
  webchat: new DirectConnector("webchat"),
  manual: new DirectConnector("manual"),
  whatsapp: new WhatsAppConnector(),
  facebook: new MessengerConnector(),
  instagram: new InstagramConnector(),
  telegram: new TelegramConnector(),
  viber: new ViberConnector(),
  sms: new SmsConnector(),
  email: new UnconfiguredConnector("email"),
};

export function getConnector(type: ChannelType): Channel {
  return REGISTRY[type];
}

const VALID = new Set(Object.keys(REGISTRY));
export function isChannelType(value: string): value is ChannelType {
  return VALID.has(value);
}
