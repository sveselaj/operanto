import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  normaliseRecoveryCode,
  totpEnrolmentUri,
  verifyTotp,
} from "@/lib/totp";

/**
 * Verified against the RFC 6238 reference vectors — a hand-rolled TOTP that
 * merely "looks right" is worse than none, because it produces codes that a
 * real authenticator app will not match.
 */

// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("RFC 6238 reference vectors (SHA-1, 6 digits)", () => {
  // The RFC prints 8 digits; a 6-digit implementation yields the last 6.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("time %i produces %s", (seconds, expected) => {
    expect(generateTotp(RFC_SECRET, new Date(seconds * 1000))).toBe(expected);
  });
});

describe("base32", () => {
  it("round-trips", () => {
    const original = Buffer.from("operanto-totp-secret");
    expect(base32Decode(base32Encode(original)).equals(original)).toBe(true);
  });

  it("uses only the RFC 4648 alphabet, so authenticator apps accept it", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]+$/);
  });

  it("rejects an invalid secret rather than producing wrong codes", () => {
    expect(() => base32Decode("nope!1")).toThrow(/Invalid base32/);
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();
  const now = new Date("2026-07-31T12:00:00.000Z");

  it("accepts the current code", () => {
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, code, { at: now }).valid).toBe(true);
  });

  it("accepts one step either side, for clock drift", () => {
    for (const drift of [-30_000, 30_000]) {
      const code = generateTotp(secret, new Date(now.getTime() + drift));
      expect(verifyTotp(secret, code, { at: now }).valid).toBe(true);
    }
  });

  it("rejects a code from outside the window", () => {
    const stale = generateTotp(secret, new Date(now.getTime() - 120_000));
    expect(verifyTotp(secret, stale, { at: now }).valid).toBe(false);
  });

  it("returns the matched counter so a used code can be refused later", () => {
    const code = generateTotp(secret, now);
    const result = verifyTotp(secret, code, { at: now });
    expect(result.counter).toBe(Math.floor(now.getTime() / 1000 / 30));
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      expect(verifyTotp(secret, bad, { at: now }).valid).toBe(false);
    }
  });

  it("tolerates spaces and separators the user may type", () => {
    const code = generateTotp(secret, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced, { at: now }).valid).toBe(true);
  });

  it("rejects a code generated from a different secret", () => {
    const other = generateTotp(generateTotpSecret(), now);
    expect(verifyTotp(secret, other, { at: now }).valid).toBe(false);
  });
});

describe("enrolment URI", () => {
  it("is a scannable otpauth URI carrying issuer and account", () => {
    const uri = totpEnrolmentUri({
      secret: "JBSWY3DPEHPK3PXP",
      accountEmail: "person@example.com",
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("Operanto%3Aperson%40example.com");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("recovery codes", () => {
  it("issues distinct, human-transcribable codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^([0-9A-F]{4}-){4}[0-9A-F]{4}$/);
  });

  it("carries 80 bits, because the stored hash is unsalted", () => {
    // These are looked up BY hash, so they cannot be salted, so a leaked
    // database is an offline brute-force target and the entropy is the only
    // defence. 20 hex characters = 80 bits. This assertion is the reason the
    // format may not be shortened for readability.
    for (const code of generateRecoveryCodes(3)) {
      expect(normaliseRecoveryCode(code)).toHaveLength(20);
    }
  });

  it("normalises what a user actually types back", () => {
    expect(normaliseRecoveryCode(" a1b2c-3d4e5 ")).toBe("A1B2C3D4E5");
    expect(normaliseRecoveryCode("A1B2C3D4E5")).toBe("A1B2C3D4E5");
  });
});

describe("implementation cross-check", () => {
  it("matches an independent HOTP computation", () => {
    // Recomputed here from the spec rather than trusting the module twice.
    const secret = "JBSWY3DPEHPK3PXP";
    const at = new Date(1_700_000_000_000);
    const counter = Math.floor(at.getTime() / 1000 / 30);
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const digest = createHmac("sha1", base32Decode(secret)).update(buf).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3];
    expect(generateTotp(secret, at)).toBe(String(binary % 1_000_000).padStart(6, "0"));
  });
});
