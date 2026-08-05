import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { COCKPIT_PREFIXES, proxy } from "@/proxy";

function req(url: string, host?: string): NextRequest {
  return new NextRequest(url, {
    headers: host ? { host } : undefined,
  });
}

const PROD = {
  NEXT_PUBLIC_SITE_URL: "https://operanto.ai",
  NEXT_PUBLIC_APP_URL: "https://app.operanto.ai",
  NEXT_PUBLIC_API_URL: "https://api.operanto.ai",
};

/** One domain serves everything: local acceptance runs, and any small
 *  single-domain deployment. */
const SINGLE_ORIGIN = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_API_URL: "http://localhost:3000",
};

const STAGING = {
  NEXT_PUBLIC_SITE_URL: "https://staging.operanto.ai",
  NEXT_PUBLIC_APP_URL: "https://staging.operanto.ai",
  NEXT_PUBLIC_API_URL: "https://api-staging.operanto.ai",
};

function stubEnv(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("production host separation", () => {
  beforeEach(() => stubEnv(PROD));

  it("API host serves only /api/*", () => {
    const api = proxy(req("https://x/api/health", "api.operanto.ai"));
    expect(api.status).toBe(200);
    const marketing = proxy(req("https://x/", "api.operanto.ai"));
    expect(marketing.status).toBe(404);
    const cockpit = proxy(req("https://x/dashboard", "api.operanto.ai"));
    expect(cockpit.status).toBe(404);
  });

  it("app host redirects / to /dashboard", () => {
    const res = proxy(req("https://x/", "app.operanto.ai"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("marketing host serves no application API (only health + scheduler)", () => {
    expect(
      proxy(req("https://x/api/v1/integrations/pronatona/events", "operanto.ai")).status,
    ).toBe(404);
    expect(proxy(req("https://x/api/auth/session", "operanto.ai")).status).toBe(404);
    // Uptime probes and the CRON_SECRET-protected scheduler stay reachable.
    expect(proxy(req("https://x/api/health", "operanto.ai")).status).toBe(200);
    expect(proxy(req("https://x/api/health/database", "operanto.ai")).status).toBe(200);
    expect(
      proxy(req("https://x/api/internal/events/retry", "operanto.ai")).status,
    ).toBe(200);
  });

  it("cockpit host keeps auth but not the ingestion surface", () => {
    expect(proxy(req("https://x/api/auth/session", "app.operanto.ai")).status).toBe(200);
    expect(
      proxy(req("https://x/api/v1/integrations/pronatona/events", "app.operanto.ai")).status,
    ).toBe(404);
  });

  it("marketing host redirects cockpit paths to the app host", () => {
    const res = proxy(req("https://x/dashboard", "operanto.ai"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.operanto.ai/dashboard");
    // similarly-prefixed marketing path is NOT treated as cockpit
    const settingsy = proxy(req("https://x/settingsomething", "operanto.ai"));
    expect(settingsy.status).toBe(200);
  });

  it("unknown hosts get marketing only: cockpit redirects, api 404s, health allowed", () => {
    expect(
      proxy(req("https://x/dashboard", "evil.example.com")).headers.get("location"),
    ).toBe("https://app.operanto.ai/dashboard");
    expect(proxy(req("https://x/api/v1/integrations/pronatona/events", "evil.example.com")).status).toBe(404);
    expect(proxy(req("https://x/api/auth/session", "evil.example.com")).status).toBe(404);
    expect(proxy(req("https://x/api/health", "preview-abc.vercel.app")).status).toBe(200);
    expect(
      proxy(req("https://x/api/internal/events/retry", "preview-abc.vercel.app")).status,
    ).toBe(200);
    expect(proxy(req("https://x/", "preview-abc.vercel.app")).status).toBe(200);
  });

  it("host matching is case-insensitive and never trusts a forwarded header alone", () => {
    const res = proxy(req("https://x/", "APP.OPERANTO.AI"));
    expect(res.headers.get("location")).toContain("/dashboard");
    // A forged X-Forwarded-Host with an unknown Host still hits the safe default.
    const forged = new NextRequest("https://x/api/v1/integrations/pronatona/events", {
      headers: { host: "evil.example.com", "x-forwarded-host": "api.operanto.ai" },
    });
    expect(proxy(forged).status).toBe(404);
  });
});

describe("staging combined-host mode (site == app, separate api)", () => {
  beforeEach(() => stubEnv(STAGING));

  it("staging host serves both marketing and cockpit paths", () => {
    expect(proxy(req("https://x/", "staging.operanto.ai")).status).toBe(200);
    expect(proxy(req("https://x/dashboard", "staging.operanto.ai")).status).toBe(200);
    expect(proxy(req("https://x/product", "staging.operanto.ai")).status).toBe(200);
  });

  it("api-staging host is still isolated to /api/*", () => {
    expect(proxy(req("https://x/api/health", "api-staging.operanto.ai")).status).toBe(200);
    expect(proxy(req("https://x/dashboard", "api-staging.operanto.ai")).status).toBe(404);
    expect(proxy(req("https://x/", "api-staging.operanto.ai")).status).toBe(404);
  });
});

describe("single-origin mode (site == app == api)", () => {
  beforeEach(() => stubEnv(SINGLE_ORIGIN));

  it("serves event ingestion, because this host IS the API host", () => {
    // The app-host branch is reached first when the hosts are equal. Without
    // an explicit exemption it 404s ingestion and the integration is dead on
    // a single-domain deployment, with nothing in the logs but a 404.
    const res = proxy(req("http://localhost:3000/api/v1/integrations/pronatona/events", "localhost:3000"));
    expect(res.status).toBe(200);
  });

  it("still serves the cockpit and marketing from the same host", () => {
    expect(proxy(req("http://localhost:3000/dashboard", "localhost:3000")).status).toBe(200);
    expect(proxy(req("http://localhost:3000/", "localhost:3000")).status).toBe(200);
  });

  it("keeps ingestion off a host that is not the API host", () => {
    // The exemption must be exactly "this host is the API host", not "the
    // hosts happen to be configured the same".
    stubEnv({ NEXT_PUBLIC_API_URL: "https://api.operanto.ai" });
    const res = proxy(req("http://localhost:3000/api/v1/integrations/pronatona/events", "localhost:3000"));
    expect(res.status).toBe(404);
  });
});

describe("unconfigured single-host dev", () => {
  it("is a no-op", () => {
    stubEnv({ NEXT_PUBLIC_SITE_URL: "", NEXT_PUBLIC_APP_URL: "", NEXT_PUBLIC_API_URL: "" });
    expect(proxy(req("http://localhost:3000/dashboard", "localhost:3000")).status).toBe(200);
  });
});

describe("cockpit prefix coverage", () => {
  it("registers every route group under (app)", () => {
    // A cockpit area missing from COCKPIT_PREFIXES renders on the marketing
    // host and on unknown hosts instead of redirecting to the canonical app
    // host. This caught /crm and /notifications (OI-3/OI-4) and the older
    // /conversations and /growth areas.
    const appDir = join(__dirname, "app", "(app)");
    const areas = readdirSync(appDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // Route groups "(x)" and dynamic segments "[x]" are not URL prefixes.
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("(") && !name.startsWith("["));

    const uncovered = areas.filter(
      (area) => !COCKPIT_PREFIXES.includes(`/${area}`),
    );
    expect(uncovered).toEqual([]);
  });
});
