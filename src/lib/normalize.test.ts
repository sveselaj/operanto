import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Arta.K@Example.COM ")).toBe("arta.k@example.com");
  });
  it("rejects non-emails and empties", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("strips formatting and keeps international prefix", () => {
    expect(normalizePhone("+383 44 123-456")).toBe("+38344123456");
    expect(normalizePhone("00383 44 123 456")).toBe("+38344123456");
  });
  it("keeps local numbers local — no country-code inference", () => {
    expect(normalizePhone("044 123 456")).toBe("044123456");
    // A local and an international spelling of the "same" number must NOT
    // collide: unsafe merging is worse than a duplicate customer.
    expect(normalizePhone("044 123 456")).not.toBe(normalizePhone("+383 44 123 456"));
  });
  it("rejects too-short values and empties", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
