import "server-only";
import { createHash } from "node:crypto";
import type { MembershipRole, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { identifierKey, rateLimit } from "@/lib/rate-limit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
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
const ROLES_REQUIRING_2FA: MembershipRole[] = ["ADMIN", "SUPERVISOR", "AUDITOR"];

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

  // A correct password plus an unlimited number of 6-digit guesses is not two
  // factors. Limited here rather than only on the login route, so every caller
  // (including disable) is covered. Sensitive: refuses rather than degrades if
  // the shared backend is down.
  const attempts = await rateLimit(
    `2fa:user:${identifierKey(user.id)}`,
    10,
    15 * 60_000,
    { sensitive: true },
  );
  if (!attempts.allowed) return false;

  const totp = verifyTotp(decryptSecret(user.totpSecretEncrypted), token);
  if (totp.valid && totp.counter !== undefined) {
    // Atomic claim, not check-then-act: two requests presenting the same code
    // at the same moment would both pass a read-then-write guard, which is
    // precisely the replay this is meant to stop. Only the request whose
    // conditional UPDATE matches a row wins.
    const counter = BigInt(totp.counter);
    const claimed = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: counter } }],
      },
      data: { totpLastCounter: counter },
    });
    return claimed.count === 1;
  }

  // Recovery code. array_remove is evaluated against the CURRENT row inside
  // the statement, so two different codes consumed concurrently cannot
  // resurrect one another — which read-modify-write of the whole array does.
  // The `= ANY(...)` guard means the same code twice matches only once.
  const candidate = hashRecoveryCode(token);
  const consumed = await prisma.$executeRaw`
    UPDATE "User"
    SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${candidate})
    WHERE "id" = ${user.id}
      AND ${candidate} = ANY("recoveryCodeHashes")
  `;
  return consumed === 1;
}

/**
 * Turn 2FA off. Requires a valid second factor, so someone who walks up to an
 * unlocked screen cannot quietly remove it.
 */
export async function disableTwoFactor(
  userId: string,
  currentToken: string,
  role: MembershipRole,
): Promise<void> {
  // The UI hides the control for these roles; that is presentation, not a
  // control. A server action is a public endpoint.
  if (roleRequiresTwoFactor(role)) {
    throw new Error(
      "Your role requires two-factor authentication; it cannot be turned off.",
    );
  }
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

/**
 * Begin a ROTATION of an active second factor — the path for a lost, shared
 * or compromised authenticator. Requires proving the CURRENT factor (TOTP or
 * a recovery code), then issues a candidate secret into a separate pending
 * slot: the active secret keeps working until the new one is proved, so a
 * privileged account (which may not turn 2FA off at all) is never locked out
 * or left unprotected mid-rotation.
 */
export async function beginTwoFactorRotation(
  userId: string,
  currentToken: string,
): Promise<{ secret: string; uri: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpConfirmedAt) {
    throw new Error("Two-factor authentication is not active; enrol instead.");
  }
  const verified = await verifySecondFactor(userId, currentToken);
  if (!verified) {
    throw new Error("Enter a valid current code (or a recovery code) to rotate.");
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpPendingSecretEncrypted: encryptSecret(secret) },
  });
  return { secret, uri: totpEnrolmentUri({ secret, accountEmail: user.email }) };
}

/**
 * Complete a rotation by proving a code from the NEW authenticator. Promotes
 * the pending secret, resets the replay counter, and issues fresh recovery
 * codes — the old ones are invalidated, because a compromised enrolment's
 * recovery codes are exactly as dangerous as its secret.
 */
export async function confirmTwoFactorRotation(
  userId: string,
  token: string,
): Promise<{ recoveryCodes: string[] }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpPendingSecretEncrypted) throw new Error("Start the rotation first");

  const result = verifyTotp(decryptSecret(user.totpPendingSecretEncrypted), token);
  if (!result.valid) {
    throw new Error("That code is not valid. Use the code from the NEW authenticator.");
  }

  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretEncrypted: user.totpPendingSecretEncrypted,
      totpPendingSecretEncrypted: null,
      totpConfirmedAt: new Date(),
      totpLastCounter: BigInt(result.counter ?? 0),
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    },
  });
  return { recoveryCodes };
}

/** Abandon a started rotation; the active authenticator is untouched. */
export async function cancelTwoFactorRotation(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { totpPendingSecretEncrypted: null },
  });
}

export async function twoFactorStatus(userId: string): Promise<{
  active: boolean;
  enrolmentStarted: boolean;
  rotationStarted: boolean;
  recoveryCodesRemaining: number;
}> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    active: Boolean(user.totpConfirmedAt),
    enrolmentStarted: Boolean(user.totpSecretEncrypted) && !user.totpConfirmedAt,
    rotationStarted: Boolean(user.totpPendingSecretEncrypted),
    recoveryCodesRemaining: user.recoveryCodeHashes.length,
  };
}
