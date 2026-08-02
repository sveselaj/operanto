import type { ChannelType } from "@prisma/client";
import type { ConversationChannelAdapter } from "@/lib/channels/types";
import { SimulatorChannelAdapter } from "@/lib/channels/simulator-adapter";
import { WhatsAppCloudAdapter } from "@/lib/channels/whatsapp-adapter";

/**
 * Adapter registry — deny by default. MANUAL deliberately has no adapter:
 * manual messages are records, not transmissions, and nothing may ever
 * "process" them through a channel. Unknown types return null and the
 * pipeline refuses the event.
 */

const ADAPTERS: Partial<Record<ChannelType, ConversationChannelAdapter>> = {
  SIMULATOR: new SimulatorChannelAdapter(),
  WHATSAPP: new WhatsAppCloudAdapter(),
};

export function getChannelAdapter(
  type: ChannelType,
): ConversationChannelAdapter | null {
  return ADAPTERS[type] ?? null;
}
