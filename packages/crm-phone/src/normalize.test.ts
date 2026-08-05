import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "./normalize";

describe("normalizePhone", () => {
  it("normalizes German national numbers to +49", () => {
    expect(normalizePhone("030 1234567")).toBe("+49301234567");
    expect(normalizePhone("0171 234 56 78")).toBe("+491712345678");
    expect(normalizePhone("089/123456")).toBe("+4989123456");
    expect(normalizePhone("(030) 12-34-56")).toBe("+4930123456");
  });

  it("keeps international formats and treats 0049/+49 identically", () => {
    expect(normalizePhone("+49 30 1234567")).toBe("+49301234567");
    expect(normalizePhone("0049 30 1234567")).toBe("+49301234567");
    expect(normalizePhone("+43 1 5877766")).toBe("+4315877766");
    // libphonenumber's documented country-code extraction handles bare "49…".
    expect(normalizePhone("4930123456789")).toBe("+4930123456789");
  });

  it("rejects garbage instead of fabricating numbers", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("123")).toBeNull(); // too short
    expect(normalizePhone("not a phone")).toBeNull();
  });

  it("is idempotent", () => {
    const once = normalizePhone("030 1234567");
    expect(normalizePhone(once)).toBe(once);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Max.Mustermann@Example.COM ")).toBe("max.mustermann@example.com");
  });

  it("rejects non-emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});
