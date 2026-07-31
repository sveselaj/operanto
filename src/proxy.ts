import { NextResponse, type NextRequest } from "next/server";

/**
 * Host-based surface separation (Next 16 proxy, formerly middleware).
 *
 * One deployment can serve up to three hosts:
 *   marketing  (NEXT_PUBLIC_SITE_URL)   — public pages
 *   cockpit    (NEXT_PUBLIC_APP_URL)    — app; "/" lands on /dashboard
 *   api        (NEXT_PUBLIC_API_URL)    — /api/* only
 *
 * The three env URLs form an EXPLICIT host allowlist. A request whose Host is
 * not on the allowlist (unknown domains pointed at the deployment, preview
 * URLs) gets the least-privileged surface: marketing pages and basic health
 * only — cockpit paths redirect to the canonical app host and other /api/*
 * returns 404. Staging may map marketing+cockpit onto ONE host (site == app);
 * the API host is still isolated in that case.
 *
 * Host-header trust: Vercel's proxy normalizes Host/X-Forwarded-Host to the
 * routed domain, and this file only ever selects a SURFACE from it — never an
 * identity, tenant, or permission. Authentication and authorization are
 * re-checked inside every page, server action, and route handler
 * (data-access-layer pattern), so a spoofed Host on a direct origin hit can at
 * worst render the marketing shell.
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
  "/two-factor",
];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function isCockpitPath(pathname: string): boolean {
  return COCKPIT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Uptime probes — safe to answer on any host, expose no configuration. */
function isHealthPath(pathname: string): boolean {
  return pathname === "/api/health" || pathname.startsWith("/api/health/");
}

/**
 * Scheduler surface (retry sweep, event status). Every route behind it
 * requires CRON_SECRET, and the platform scheduler addresses the deployment's
 * production alias rather than a host we choose, so it is answered anywhere.
 */
function isSchedulerPath(pathname: string): boolean {
  return pathname.startsWith("/api/internal/");
}

export function proxy(request: NextRequest) {
  const siteHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL);
  const appHost = hostOf(process.env.NEXT_PUBLIC_APP_URL);
  const apiHost = hostOf(process.env.NEXT_PUBLIC_API_URL);

  // Not configured (local dev fallback) — single surface, nothing to separate.
  if (!siteHost || !appHost) return NextResponse.next();

  const requestHost = request.headers.get("host")?.toLowerCase() ?? "";
  const { pathname } = request.nextUrl;

  // API host: strictly API — never renders marketing or cockpit HTML.
  if (apiHost && requestHost === apiHost && apiHost !== appHost) {
    if (!pathname.startsWith("/api/")) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  if (requestHost === appHost) {
    // The event-ingestion surface belongs to the API host alone — unless this
    // deployment puts the API on the same host, which single-origin setups
    // (local, and any small deployment with one domain) do. Without the second
    // clause the host that IS the API host still 404s ingestion, because this
    // branch is reached first whenever apiHost === appHost.
    if (pathname.startsWith("/api/v1/") && requestHost !== apiHost) {
      return new NextResponse(null, { status: 404 });
    }
    // Combined-host mode (staging: site == app) serves marketing too;
    // dedicated app host redirects "/" into the cockpit.
    if (pathname === "/" && siteHost !== appHost) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (requestHost === siteHost) {
    // Marketing host: cockpit lives on the app domain…
    if (isCockpitPath(pathname)) {
      const target = new URL(pathname + request.nextUrl.search, `https://${appHost}`);
      return NextResponse.redirect(target);
    }
    // …and no application API answers here. Health probes and the
    // secret-protected scheduler surface are the only exceptions.
    if (
      pathname.startsWith("/api/") &&
      !isHealthPath(pathname) &&
      !isSchedulerPath(pathname)
    ) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  // Unknown host (not on the allowlist): least-privileged surface.
  if (isCockpitPath(pathname)) {
    return NextResponse.redirect(
      new URL(pathname + request.nextUrl.search, `https://${appHost}`),
    );
  }
  if (pathname.startsWith("/api/")) {
    if (isHealthPath(pathname) || isSchedulerPath(pathname)) {
      return NextResponse.next();
    }
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's build output. Deliberately NOT excluding paths
  // that merely contain a dot: dynamic segments such as /customers/[id],
  // /opportunities/[id] and /invite/[token] can legitimately contain dots, and
  // excluding them would silently skip host separation for those requests.
  matcher: ["/((?!_next/).*)"],
};
