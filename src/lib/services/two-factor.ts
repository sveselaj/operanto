import "server-only";
import { createHash } from "node:crypto";
import type { MembershipRole, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, safeEqual } from "@/lib/crypto";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normaliseRecoveryCode,
  totpEnrolmentUri,
  verifyTotp,
} from "@/lib/totp";

/**
 * Two-factor authentication.
 *
 * Enrolment is two-phase on purpose: the secret is stored the moment it is
 * generated, but 2FA only becomes active once the user has proved they can
 * produce a valid code. A single-phase enrolment locks people out of their own
 * account whenever the QR is scanned into the wrong app.
 */

/** Roles that must have 2FA — they can read every customer in the tenant. */
const ROLES_REQUIRING_2FA: MembershipRole[] = ["ADMIN", "SUPERVISOR"];

export function roleRequiresTwoFactor(role: MembershipRole): boolean {
  return ROLES_REQUIRING_2FA.includes(role);
}

export function twoFactorActive(user: Pick<User, "totpConfirmedAt">): boolean {
  return Boolean(user.totpConfirmedAt);
}

const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");

/**
 * Begin enrolment: mint a secret and return what the authenticator app needs.
 * Any half-finished previous attempt is replaced, and an already-active
 * enrolment is never silently overwritten.
 */
export async function beginTwoFactorEnrolment(userId: string): Promise<{
  secret: string;
  uri: string;
}> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpConfirmedAt) {
    throw new Error("Two-factor authentication is already active");
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecretEncrypted: encryptSecret(secret), totpLastCounter: null },
  });

  return {
    secret,
    uri: totpEnrolmentUri({ secret, accountEmail: user.email }),
  };
}

/**
 * Complete enrolment by proving a code. Returns the recovery codes, which are
 * shown exactly once — only their hashes are kept.
 */
export async function confirmTwoFactorEnrolment(
  userId: string,
  token: string,
): Promise<{ recoveryCodes: string[] }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpConfirmedAt) {
    throw new Error("Two-factor authentication is already active");
  }
  if (!user.totpSecretEncrypted) {
    throw new Error("Start enrolment first");
  }

  const result = verifyTotp(decryptSecret(user.totpSecretEncrypted), token);
  if (!result.valid) throw new Error("That code is not valid. Try the current one.");

  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpConfirmedAt: new Date(),
      totpLastCounter: BigInt(result.counter ?? 0),
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    },
  });
  return { recoveryCodes };
}

/**
 * Verify a second factor at sign-in. Accepts a TOTP code or a recovery code.
 *
 * A TOTP counter is accepted only once: without that, an observed code stays
 * usable for the rest of its window. A recovery code is consumed on use.
 */
export async function verifySecondFactor(
  userId: string,
  submitted: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpConfirmedAt || !user.totpSecretEncrypted) return false;

  const token = submitted.trim();
  if (!token) return false;

  const totp = verifyTotp(decryptSecret(user.totpSecretEncrypted), token);
  if (totp.valid && totp.counter !== undefined) {
    if (user.totpLastCounter !== null && BigInt(totp.counter) <= user.totpLastCounter) {
      // Already used — a replay inside the validity window.
      return false;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpLastCounter: BigInt(totp.counter) },
    });
    return true;
  }

  // Recovery code: constant-time compare against each stored hash, then burn.
  const candidate = hashRecoveryCode(token);
  const match = user.recoveryCodeHashes.find((stored) => safeEqual(stored, candidate));
  if (!match) return false;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      recoveryCodeHashes: user.recoveryCodeHashes.filter((hash) => hash !== match),
    },
  });
  return true;
}

/**
 * Turn 2FA off. Requires a valid second factor, so someone who walks up to an
 * unlocked screen cannot quietly remove it.
 */
export async function disableTwoFactor(
  userId: string,
  currentToken: string,
): Promise<void> {
  const verified = await verifySecondFactor(userId, currentToken);
  if (!verified) throw new Error("Enter a valid code to turn off two-factor.");
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecretEncrypted: null,
      totpConfirmedAt: null,
      totpLastCounter: null,
      recoveryCodeHashes: [],
    },
  });
}

export async function twoFactorStatus(userId: string): Promise<{
  active: boolean;
  enrolmentStarted: boolean;
  recoveryCodesRemaining: number;
}> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    active: Boolean(user.totpConfirmedAt),
    enrolmentStarted: Boolean(user.totpSecretEncrypted) && !user.totpConfirmedAt,
    recoveryCodesRemaining: user.recoveryCodeHashes.length,
  };
}
