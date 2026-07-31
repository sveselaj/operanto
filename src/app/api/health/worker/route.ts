import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeEqual } from "@/lib/crypto";
import { MAX_ATTEMPTS } from "@/lib/events/process";

/**
 * Event-processing health. Protected with CRON_SECRET: the numbers are
 * aggregates (no tenant data), but processing depth is operational
 * information, not for the public internet.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const [pending, stuck, failed, deadLetter, lastProcessed] = await Promise.all([
    prisma.inboundEvent.count({
      where: { processingStatus: { in: ["RECEIVED", "PROCESSING"] } },
    }),
    prisma.inboundEvent.count({
      where: {
        processingStatus: { in: ["RECEIVED", "PROCESSING"] },
        receivedAt: { lt: staleBefore },
      },
    }),
    prisma.inboundEvent.count({
      where: { processingStatus: "FAILED", attemptCount: { lt: MAX_ATTEMPTS } },
    }),
    prisma.inboundEvent.count({ where: { processingStatus: "DEAD_LETTER" } }),
    prisma.inboundEvent.findFirst({
      where: { processingStatus: "PROCESSED" },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),
  ]);

  // Healthy = nothing stuck beyond the sweep window and nothing dead-lettered.
  const ok = stuck === 0 && deadLetter === 0;
  return NextResponse.json(
    {
      ok,
      pending,
      stuck,
      retryable: failed,
      deadLetter,
      lastProcessedAt: lastProcessed?.processedAt ?? null,
    },
    { status: ok ? 200 : 503 },
  );
}
