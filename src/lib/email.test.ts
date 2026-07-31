import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverInvitation, emailConfigured } from "@/lib/email";

/**
 * The invitation link is a bearer credential. These tests are about what must
 * NOT happen to it: no logging in production, no assumption of delivery, no
 * provider payload retained.
 */

const INPUT = {
  to: "person@example.com",
  organisationName: "Pronatona",
  role: "OPERATOR",
  acceptUrl: "https://staging.operanto.ai/invite/SECRET-TOKEN-VALUE",
  expiresAt: new Date("2026-08-07T00:00:00.000Z"),
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unconfigured", () => {
  it("is optional for local development: logs the link and reports NOT delivered", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(emailConfigured()).toBe(false);
    const result = await deliverInvitation(INPUT);

    expect(result.delivered).toBe(false);
    if (!result.delivered) expect(result.previewUrl).toBe(INPUT.acceptUrl);
    expect(JSON.stringify(log.mock.calls)).toContain("SECRET-TOKEN-VALUE");
  });

  it("NEVER logs the link in production, and reports NOT delivered", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await deliverInvitation(INPUT);

    expect(result.delivered).toBe(false);
    if (!result.delivered) expect(result.previewUrl).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET-TOKEN-VALUE");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("configured", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Operanto <access@mail.operanto.ai>");
  });

  it("sends through the provider with the configured sender and reply-to", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "hello@operanto.ai");
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await deliverInvitation(INPUT);
    expect(result.delivered).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("Operanto <access@mail.operanto.ai>");
    expect(body.reply_to).toEqual(["hello@operanto.ai"]);
    expect(body.to).toEqual(["person@example.com"]);
    // The link is in the message body — that is the whole point of sending it.
    expect(body.text).toContain(INPUT.acceptUrl);
    // The API key travels in the header, never in the body.
    expect(JSON.stringify(body)).not.toContain("re_test_key");
  });

  it("omits reply-to when not configured", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "");
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await deliverInvitation(INPUT);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.reply_to).toBeUndefined();
  });

  it("reports NOT delivered on a provider error, keeping only the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        // A provider error body can echo the message, including the link.
        new Response(JSON.stringify({ message: INPUT.acceptUrl }), { status: 422 }),
      ),
    );
    const result = await deliverInvitation(INPUT);
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.reason).toContain("422");
      expect(result.reason).not.toContain("SECRET-TOKEN-VALUE");
    }
  });

  it("reports NOT delivered when the provider is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const result = await deliverInvitation(INPUT);
    expect(result.delivered).toBe(false);
    if (!result.delivered) expect(result.reason).toMatch(/unreachable/i);
  });

  it("never exposes the API key in the result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom re_test_key")));
    const result = await deliverInvitation(INPUT);
    expect(JSON.stringify(result)).not.toContain("re_test_key");
  });
});
