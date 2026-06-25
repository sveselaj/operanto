import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./crypto";

let savedKey: string | undefined;
let savedAuth: string | undefined;
beforeEach(() => {
  savedKey = process.env.ENCRYPTION_KEY;
  savedAuth = process.env.AUTH_SECRET;
  process.env.ENCRYPTION_KEY = "test-encryption-key-aaaaaaaaaaaaaaaaaaaa";
  delete process.env.OPERANTO_ENCRYPTION_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
  if (savedAuth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedAuth;
});

describe("channel credential crypto", () => {
  it("round-trips a secret", () => {
    const token = encryptSecret("super-secret-page-token");
    expect(token).toMatch(/^v1\./);
    expect(token).not.toContain("super-secret");
    expect(decryptSecret(token)).toBe("super-secret-page-token");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("fails to decrypt a tampered token", () => {
    const token = encryptSecret("abc");
    const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("reports configured when a key env var is present", () => {
    expect(isEncryptionConfigured()).toBe(true);
    delete process.env.ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
  });
});
