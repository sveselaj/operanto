import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) and recovery codes.
 *
 * Implemented directly rather than pulled from a package: the algorithm is
 * about thirty lines, it is fully specified, and it sits on the authentication
 * path where an unaudited transitive dependency is a poor trade. No secret
 * ever leaves this module in plaintext except to build the enrolment URI.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** One step either side, so a slightly wrong device clock still works. */
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  // 20 bytes = 160 bits, the RFC 4226 recommendation.
  return base32Encode(randomBytes(20));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code for a given counter step. */
function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  // Counter is 64-bit; JS bitwise ops are 32-bit, so write it in two halves.
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function generateTotp(secretBase32: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verify a submitted code, accepting one step either side of now.
 *
 * Returns the matched counter so the caller can reject a code that has already
 * been used — without that, a code stays valid for its whole window and a
 * shoulder-surfed or intercepted code can be replayed.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  options: { at?: Date; window?: number } = {},
): { valid: boolean; counter?: number } {
  const cleaned = token.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return { valid: false };

  const secret = base32Decode(secretBase32);
  const current = Math.floor(
    (options.at ?? new Date()).getTime() / 1000 / PERIOD_SECONDS,
  );
  const window = options.window ?? DEFAULT_WINDOW;

  for (let offset = -window; offset <= window; offset++) {
    const counter = current + offset;
    if (safeEqualString(hotp(secret, counter), cleaned)) {
      return { valid: true, counter };
    }
  }
  return { valid: false };
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** The otpauth:// URI an authenticator app scans. */
export function totpEnrolmentUri(input: {
  secret: string;
  accountEmail: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? "Operanto";
  const label = encodeURIComponent(`${issuer}:${input.accountEmail}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes: the way back in when the phone is lost. Returned once in
 * plaintext, stored only as hashes.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(5)
      .toString("hex")
      .toUpperCase()
      .replace(/(.{5})/, "$1-"),
  );
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
