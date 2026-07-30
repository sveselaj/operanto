import { describe, it, expect } from "vitest";
import { parseConversationFilters } from "@/lib/inbox-filters";

describe("parseConversationFilters", () => {
  it("defaults everything to 'all' / undefined when empty", () => {
    expect(parseConversationFilters({})).toEqual({
      status: "all",
      channel: "all",
      assignee: "all",
      q: undefined,
    });
  });

  it("accepts valid status and channel values", () => {
    const f = parseConversationFilters({ status: "open", channel: "whatsapp" });
    expect(f.status).toBe("open");
    expect(f.channel).toBe("whatsapp");
  });

  it("falls back to 'all' for unknown status/channel (no injection through)", () => {
    const f = parseConversationFilters({ status: "garbage", channel: "carrier-pigeon" });
    expect(f.status).toBe("all");
    expect(f.channel).toBe("all");
  });

  it("takes the first value when a param is repeated", () => {
    const f = parseConversationFilters({ status: ["pending", "open"] });
    expect(f.status).toBe("pending");
  });

  it("trims the search query and drops it when blank", () => {
    expect(parseConversationFilters({ q: "  hello  " }).q).toBe("hello");
    expect(parseConversationFilters({ q: "   " }).q).toBeUndefined();
  });

  it("passes assignee through verbatim", () => {
    expect(parseConversationFilters({ assignee: "me" }).assignee).toBe("me");
  });
});
