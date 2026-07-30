import type { ConversationFilters } from "@/lib/services/conversations";
import type { ConversationStatus, ChannelType } from "@prisma/client";

type RawParams = Record<string, string | string[] | undefined>;

const STATUSES = ["open", "pending", "waiting_customer", "resolved", "archived"];
const CHANNELS = ["instagram", "facebook", "whatsapp", "email", "sms", "webchat", "manual"];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse raw search params into validated conversation filters. */
export function parseConversationFilters(sp: RawParams): ConversationFilters {
  const status = one(sp.status);
  const channel = one(sp.channel);
  const assignee = one(sp.assignee);
  const q = one(sp.q);

  return {
    status: status && STATUSES.includes(status) ? (status as ConversationStatus) : "all",
    channel: channel && CHANNELS.includes(channel) ? (channel as ChannelType) : "all",
    assignee: assignee ?? "all",
    q: q?.trim() || undefined,
  };
}
