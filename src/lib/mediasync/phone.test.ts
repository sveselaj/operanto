import { describe, it, expect } from "vitest";
import { normalizePhone, samePhone } from "./phone";

describe("normalizePhone", () => {
  it("keeps an already-international number", () => {
    expect(normalizePhone("+38349123456")).toBe("+38349123456");
  });

  it("strips spaces, dashes and parens", () => {
    expect(normalizePhone("+383 (49) 123-456")).toBe("+38349123456");
  });

  it("treats a leading 00 as the international prefix", () => {
    expect(normalizePhone("0038349123456")).toBe("+38349123456");
  });

  it("expands a national number with the default country code, dropping trunk 0", () => {
    expect(normalizePhone("049 123 456", "383")).toBe("+38349123456");
    expect(normalizePhone("049123456", "+383")).toBe("+38349123456");
  });

  it("returns null for empty or too-short input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("samePhone", () => {
  it("matches numbers written differently", () => {
    expect(samePhone("+38349123456", "0038349123456")).toBe(true);
    expect(samePhone("049 123 456", "+38349123456", "383")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(samePhone("+38349123456", "+38349999999")).toBe(false);
  });

  it("is false when either side is unparseable", () => {
    expect(samePhone("", "+38349123456")).toBe(false);
  });
});
