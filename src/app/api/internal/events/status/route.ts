import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeEqual } from "@/lib/crypto";

/**
 * Processing status of ONE inbound event, by its source event id. Protected
 * with CRON_SECRET and deliberately minimal: status and attempt count only —
 * no payload, no tenant data. Used by operators (and acceptance tests) to
 * confirm a specific delivery landed, rather than inferring it from
 * aggregate counters.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const eventId = new URL(req.url).searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "eventId required" }, { status: 400 });
  }

  const event = await prisma.inboundEvent.findFirst({
    where: { eventId },
    select: {
      eventType: true,
      processingStatus: true,
      attemptCount: true,
      processedAt: true,
      receivedAt: true,
    },
  });

  if (!event) return NextResponse.json({ ok: true, found: false });
  return NextResponse.json({ ok: true, found: true, ...event });
}
