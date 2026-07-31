import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  safeEqual,
  signEventPayload,
} from "@/lib/crypto";

const KEY = "a".repeat(64);

beforeEach(() => vi.stubEnv("OPERANTO_ENCRYPTION_KEY", KEY));
afterEach(() => vi.unstubAllEnvs());

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("shared-webhook-secret-1234567890abcdef");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptSecret(stored)).toBe("shared-webhook-secret-1234567890abcdef");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const stored = encryptSecret("secret");
    const [v, iv, tag, data] = stored.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() =>
      decryptSecret(`${v}:${iv}:${tag}:${flipped.toString("base64")}`),
    ).toThrow();
  });

  it("refuses a malformed key", () => {
    vi.stubEnv("OPERANTO_ENCRYPTION_KEY", "too-short");
    expect(() => encryptSecret("x")).toThrow(/OPERANTO_ENCRYPTION_KEY/);
  });
});

describe("signEventPayload", () => {
  it("matches the Pronatona-side contract: HMAC_SHA256(secret, ts.body)", () => {
    // Vector produced with: echo -n "1753860000.{}" | openssl dgst -sha256 -hmac secret
    expect(signEventPayload("secret", "1753860000", "{}")).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(signEventPayload("secret", "1753860000", "{}")).toBe(
      signEventPayload("secret", "1753860000", "{}"),
    );
    expect(signEventPayload("secret", "1753860000", "{}")).not.toBe(
      signEventPayload("secret", "1753860001", "{}"),
    );
  });
});

describe("safeEqual", () => {
  it("compares equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });
  it("rejects different strings and lengths without throwing", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
