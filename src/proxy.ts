import { NextResponse, type NextRequest } from "next/server";

/**
 * Host-based surface separation (Next 16 proxy, formerly middleware).
 *
 * One deployment serves three domains:
 *   operanto.ai      → marketing pages only
 *   app.operanto.ai  → cockpit ("/" lands on /dashboard)
 *   api.operanto.ai  → /api/* only
 *
 * Locally all three PUBLIC urls point at the same host, so this is a no-op.
 * This file does NOT do authentication — every page and server action
 * re-checks the session and organisation membership itself (data-access-layer
 * pattern); the proxy only routes hosts.
 */

const COCKPIT_PREFIXES = [
  "/dashboard",
  "/customers",
  "/opportunities",
  "/tasks",
  "/activity",
  "/integrations",
  "/settings",
  "/audit",
  "/login",
  "/invite",
];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const siteHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL);
  const appHost = hostOf(process.env.NEXT_PUBLIC_APP_URL);
  const apiHost = hostOf(process.env.NEXT_PUBLIC_API_URL);

  // Single-host setup (local dev, staging preview) — nothing to separate.
  if (!siteHost || !appHost || siteHost === appHost) return NextResponse.next();

  const requestHost = request.headers.get("host");
  const { pathname } = request.nextUrl;

  if (requestHost === apiHost) {
    if (!pathname.startsWith("/api/")) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  if (requestHost === appHost) {
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Marketing host: cockpit paths live on the app domain.
  if (COCKPIT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const target = new URL(pathname + request.nextUrl.search, `https://${appHost}`);
    return NextResponse.redirect(target);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
