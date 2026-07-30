import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Invitation tokens: 32 random bytes, base64url on the wire, only the SHA-256
 * hash at rest. Raw tokens never touch logs or the database.
 */

export const INVITATION_TTL_MS = 7 * 24 * 3_600_000;

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/invite/${token}`;
}
