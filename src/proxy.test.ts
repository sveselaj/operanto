import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

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

describe("unconfigured single-host dev", () => {
  it("is a no-op", () => {
    stubEnv({ NEXT_PUBLIC_SITE_URL: "", NEXT_PUBLIC_APP_URL: "", NEXT_PUBLIC_API_URL: "" });
    expect(proxy(req("http://localhost:3000/dashboard", "localhost:3000")).status).toBe(200);
  });
});
