import { describe, expect, it } from "vitest";
import { SERVICE_WINDOW_MS, serviceWindowState } from "@/lib/channels/service-window";

describe("whatsapp 24-hour service window", () => {
  const now = new Date("2026-08-02T12:00:00Z");

  it("is open strictly within 24h of the last inbound message", () => {
    const fresh = serviceWindowState(new Date("2026-08-02T11:00:00Z"), now);
    expect(fresh.withinWindow).toBe(true);
    expect(fresh.expiresAt?.toISOString()).toBe("2026-08-03T11:00:00.000Z");

    const edge = serviceWindowState(
      new Date(now.getTime() - SERVICE_WINDOW_MS + 1000),
      now,
    );
    expect(edge.withinWindow).toBe(true);
  });

  it("closes at exactly 24h and beyond — template territory", () => {
    expect(
      serviceWindowState(new Date(now.getTime() - SERVICE_WINDOW_MS), now).withinWindow,
    ).toBe(false);
    expect(
      serviceWindowState(new Date("2026-07-30T12:00:00Z"), now).withinWindow,
    ).toBe(false);
  });

  it("no inbound message ever means no window", () => {
    expect(serviceWindowState(null, now)).toEqual({
      withinWindow: false,
      expiresAt: null,
    });
  });
});
