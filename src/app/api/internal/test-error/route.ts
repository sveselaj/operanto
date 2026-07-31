import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { captureError, observabilityConfigured } from "@/lib/observability";

/**
 * Deliberately raise a harmless error so error reporting can be verified
 * end to end.
 *
 * Two locks: it requires CRON_SECRET like the other internal routes, and it
 * refuses to run in production unless ALLOW_TEST_ERROR=1 is set explicitly —
 * so a leaked secret alone cannot manufacture production alerts or noise.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const isProduction =
    (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";
  if (isProduction && process.env.ALLOW_TEST_ERROR !== "1") {
    return NextResponse.json(
      { ok: false, error: "test errors are disabled in production" },
      { status: 403 },
    );
  }

  await captureError(
    new Error("Operanto test error — deliberately raised, safe to ignore"),
    {
      scope: "verification.test_error",
      tags: { source: "internal-test-endpoint" },
      // Included on purpose: the response below proves these were scrubbed.
      extra: { email: "should-not-appear@example.com", secret: "should-not-appear" },
    },
  );

  return NextResponse.json({
    ok: true,
    reportingConfigured: observabilityConfigured(),
    note: observabilityConfigured()
      ? "Error forwarded to the configured reporter."
      : "No DSN configured; the error was logged locally only.",
  });
}
