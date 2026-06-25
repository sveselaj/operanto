import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * MediaSync — secret encryption for channel credentials at rest.
 *
 * Channel access tokens (WhatsApp/Meta page tokens, Infobip keys) are stored
 * encrypted in `ChannelAccount.accessTokenEncrypted` and never returned to the
 * client. AES-256-GCM with a key derived from a server-only secret.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_SALT = "operanto.channel.creds.v1";

function configuredSecret(): string | undefined {
  return (
    process.env.OPERANTO_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    undefined
  );
}

function encryptionKey(): Buffer {
  const secret = configuredSecret();
  if (!secret) {
    throw new Error(
      "No encryption key configured. Set ENCRYPTION_KEY (or AUTH_SECRET).",
    );
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** True when a key is available — used to gate credential storage in the UI. */
export function isEncryptionConfigured(): boolean {
  return !!configuredSecret();
}

/** Encrypt to a self-describing token: `v1.<iv>.<tag>.<ciphertext>` (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Malformed secret token");
  const [, ivB, tagB, ctB] = parts;
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
