import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { retryPendingEvents } from "@/lib/events/process";
import { redactExpiredPayloads } from "@/lib/services/privacy";

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
  // Same schedule, so raw payloads cannot outlive their retention window
  // just because nobody remembered to add a second cron entry.
  const retention = await redactExpiredPayloads();
  return NextResponse.json({ ok: true, ...result, retention });
}

export { handle as GET, handle as POST };
