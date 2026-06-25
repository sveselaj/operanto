import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    const opts = { limit: 3, windowMs: 1000 };
    expect(rateLimit("k", opts, 0).allowed).toBe(true);
    expect(rateLimit("k", opts, 0).allowed).toBe(true);
    const third = rateLimit("k", opts, 0);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    expect(rateLimit("k", opts, 0).allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit("k", opts, 0).allowed).toBe(true);
    expect(rateLimit("k", opts, 500).allowed).toBe(false);
    expect(rateLimit("k", opts, 1000).allowed).toBe(true); // new window
  });

  it("tracks keys independently", () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit("a", opts, 0).allowed).toBe(true);
    expect(rateLimit("b", opts, 0).allowed).toBe(true);
    expect(rateLimit("a", opts, 0).allowed).toBe(false);
  });
});
