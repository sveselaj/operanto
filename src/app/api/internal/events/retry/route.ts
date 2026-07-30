import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { retryPendingEvents } from "@/lib/events/process";

/**
 * Retry sweep for failed / stuck inbound events. Invoked by a scheduler
 * (Vercel cron or external), protected by CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await retryPendingEvents();
  return NextResponse.json({ ok: true, ...result });
}
