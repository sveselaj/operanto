import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { retryPendingEvents } from "@/lib/events/process";
import { retryPendingChannelEvents } from "@/lib/services/channel-ingest";
import {
  redactExpiredChannelPayloads,
  redactExpiredMessages,
  redactExpiredPayloads,
} from "@/lib/services/privacy";

/**
 * Retry sweep for failed / stuck inbound events. Invoked by a scheduler —
 * Vercel cron sends GET with `Authorization: Bearer $CRON_SECRET`; manual
 * operations may POST with the same header.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await retryPendingEvents();
  const channels = await retryPendingChannelEvents();
  // Same schedule, so raw payloads and message bodies cannot outlive their
  // retention windows just because nobody remembered a second cron entry.
  const retention = await redactExpiredPayloads();
  const messageRetention = await redactExpiredMessages();
  const channelRetention = await redactExpiredChannelPayloads();
  return NextResponse.json({
    ok: true,
    ...result,
    channels,
    retention,
    messageRetention,
    channelRetention,
  });
}

export { handle as GET, handle as POST };
