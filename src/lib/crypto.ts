import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Secret handling.
 *
 * - Integration webhook secrets are stored encrypted (AES-256-GCM) under
 *   OPERANTO_ENCRYPTION_KEY, never in plaintext and never as a bare hash —
 *   HMAC verification needs the plaintext back.
 * - All signature/token comparisons go through `safeEqual` (timing-safe).
 */

function encryptionKey(): Buffer {
  const hex = process.env.OPERANTO_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "OPERANTO_ENCRYPTION_KEY must be set to a 32-byte hex string (64 chars)",
    );
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Output format: v1:<iv b64>:<tag b64>:<ciphertext b64> */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** HMAC-SHA256 over `timestamp + "." + rawBody`, hex-encoded. */
export function signEventPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

/** Constant-time string comparison; never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
