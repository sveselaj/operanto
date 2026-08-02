import { describe, expect, it } from "vitest";
import type { ChannelConnection } from "@prisma/client";
import { getChannelAdapter } from "@/lib/channels/registry";

describe("channel adapter registry", () => {
  it("denies by default: MANUAL and unknown types have no adapter", () => {
    expect(getChannelAdapter("MANUAL")).toBeNull();
  });

  it("the simulator adapter can never send", async () => {
    const adapter = getChannelAdapter("SIMULATOR")!;
    await expect(
      adapter.sendMessage({
        connection: { id: "c1" } as ChannelConnection,
        providerThreadId: null,
        recipientExternalId: "x",
        body: "never",
      }),
    ).rejects.toThrow(/cannot send/);
  });

  it("the simulator adapter rejects foreign payloads", () => {
    const adapter = getChannelAdapter("SIMULATOR")!;
    expect(adapter.classifyEvent({ hostile: true })).toBe("ignore");
    expect(adapter.connectionRef({ hostile: true })).toBeNull();
    expect(adapter.dedupeKey({ hostile: true })).toBeNull();
    expect(adapter.receiveEvents({ hostile: true })).toEqual([]);
  });
});
