import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Safely public: reveals only reachability and latency — no configuration. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, latencyMs: Date.now() - startedAt });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
