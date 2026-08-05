import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Second-factor verification, against a real PostgreSQL database.
 *
 * Both defects these cover are races, and a race cannot be reproduced against a
 * mock: the whole question is what the *database* does when two statements
 * arrive at once. The original implementation read the user row, decided, and
 * wrote back — so two requests carrying the same code both read "not used yet"
 * and both passed, and two requests spending different recovery codes each
 * wrote back an array computed from the stale row, resurrecting the other's
 * code. The fixes are a conditional UPDATE and a SQL `array_remove`; these
 * tests are what tells you if either is ever refactored back into a read.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
vi.mock("@/lib/prisma", () => ({ prisma: db }));

vi.stubEnv("OPERANTO_ENCRYPTION_KEY", "a".repeat(64));

const { encryptSecret } = await import("@/lib/crypto");
const { generateTotp, generateTotpSecret, normaliseRecoveryCode } =
  await import("@/lib/totp");
const {
  beginTwoFactorRotation,
  cancelTwoFactorRotation,
  confirmTwoFactorRotation,
  disableTwoFactor,
  roleRequiresTwoFactor,
  twoFactorStatus,
  verifySecondFactor,
} = await import("@/lib/services/two-factor");

const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");

const RECOVERY = ["AAAA-BBBB-CCCC-DDDD-EEEE", "1111-2222-3333-4444-5555"];

let seq = 0;

/** A fresh enrolled user per test, so the rate-limit window never bleeds across cases. */
async function enrolledUser(secret = generateTotpSecret()) {
  seq += 1;
  const user = await db.user.create({
    data: {
      email: `user${seq}@example.com`,
      name: "Test User",
      status: "ACTIVE",
      totpSecretEncrypted: encryptSecret(secret),
      totpConfirmedAt: new Date(),
      recoveryCodeHashes: RECOVERY.map(hashRecoveryCode),
    },
  });
  return { user, secret };
}

beforeAll(async () => {
  if (!TEST_URL) return;
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  if (!TEST_URL) return;
  await db.$executeRawUnsafe(`TRUNCATE TABLE "Membership", "User" CASCADE`);
});

describeDb("TOTP replay", () => {
  it("accepts a valid code", async () => {
    const { user, secret } = await enrolledUser();
    expect(await verifySecondFactor(user.id, generateTotp(secret))).toBe(true);
  });

  it("refuses the same code a second time", async () => {
    const { user, secret } = await enrolledUser();
    const code = generateTotp(secret);
    expect(await verifySecondFactor(user.id, code)).toBe(true);
    // A code stays valid for its whole 30s step plus drift. Without a used-
    // counter check, anyone who reads it over a shoulder can reuse it.
    expect(await verifySecondFactor(user.id, code)).toBe(false);
  });

  it("lets exactly one of two simultaneous submissions through", async () => {
    const { user, secret } = await enrolledUser();
    const code = generateTotp(secret);

    // The race: both requests read the row before either writes. A
    // check-then-act guard passes both.
    const results = await Promise.all([
      verifySecondFactor(user.id, code),
      verifySecondFactor(user.id, code),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a code from an earlier step once a later one is used", async () => {
    const { user, secret } = await enrolledUser();
    const previous = generateTotp(secret, new Date(Date.now() - 30_000));
    expect(await verifySecondFactor(user.id, generateTotp(secret))).toBe(true);
    expect(await verifySecondFactor(user.id, previous)).toBe(false);
  });

  it("refuses a user who never completed enrolment", async () => {
    const user = await db.user.create({
      data: { email: "unenrolled@example.com", name: "U", status: "ACTIVE" },
    });
    expect(await verifySecondFactor(user.id, "123456")).toBe(false);
  });
});

describeDb("recovery codes", () => {
  it("accepts a recovery code and consumes it", async () => {
    const { user } = await enrolledUser();
    expect(await verifySecondFactor(user.id, RECOVERY[0])).toBe(true);
    expect(await verifySecondFactor(user.id, RECOVERY[0])).toBe(false);

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.recoveryCodeHashes).toHaveLength(1);
  });

  it("consumes both when two different codes are spent at once", async () => {
    const { user } = await enrolledUser();

    // The race: each request computes the new array from the row it read, so
    // the second write puts the first request's code back.
    const results = await Promise.all([
      verifySecondFactor(user.id, RECOVERY[0]),
      verifySecondFactor(user.id, RECOVERY[1]),
    ]);

    expect(results).toEqual([true, true]);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.recoveryCodeHashes).toHaveLength(0);
  });

  it("lets exactly one of two simultaneous uses of the SAME code through", async () => {
    const { user } = await enrolledUser();
    const results = await Promise.all([
      verifySecondFactor(user.id, RECOVERY[0]),
      verifySecondFactor(user.id, RECOVERY[0]),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("accepts the code as the user actually types it", async () => {
    const { user } = await enrolledUser();
    expect(await verifySecondFactor(user.id, " aaaabbbbccccddddeeee ")).toBe(true);
  });

  it("rejects an unknown code without consuming anything", async () => {
    const { user } = await enrolledUser();
    expect(await verifySecondFactor(user.id, "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ")).toBe(false);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.recoveryCodeHashes).toHaveLength(2);
  });
});

describeDb("brute force is bounded", () => {
  it("stops accepting attempts long before 10^6 guesses", async () => {
    const { user, secret } = await enrolledUser();

    // A correct password plus unlimited 6-digit guesses is not two factors.
    for (let i = 0; i < 12; i++) {
      await verifySecondFactor(user.id, String(100000 + i).padStart(6, "0"));
    }

    // The limit is on the user, so even the genuine code is now refused.
    expect(await verifySecondFactor(user.id, generateTotp(secret))).toBe(false);
  });
});

describeDb("disabling 2FA", () => {
  it("is refused for roles that require it, even with a valid code", async () => {
    const { user, secret } = await enrolledUser();
    for (const role of ["ADMIN", "SUPERVISOR"] as const) {
      expect(roleRequiresTwoFactor(role)).toBe(true);
      // The UI hides the control; a Server Action is still a public endpoint.
      await expect(
        disableTwoFactor(user.id, generateTotp(secret), role),
      ).rejects.toThrow(/cannot be turned off/i);
    }
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totpConfirmedAt).not.toBeNull();
  });

  it("requires a valid second factor for roles that may disable it", async () => {
    const { user } = await enrolledUser();
    await expect(disableTwoFactor(user.id, "000000", "OPERATOR")).rejects.toThrow();
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totpConfirmedAt).not.toBeNull();
  });

  it("clears every credential when it does succeed", async () => {
    const { user, secret } = await enrolledUser();
    await disableTwoFactor(user.id, generateTotp(secret), "OPERATOR");
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totpSecretEncrypted).toBeNull();
    expect(after.totpConfirmedAt).toBeNull();
    expect(after.totpLastCounter).toBeNull();
    expect(after.recoveryCodeHashes).toHaveLength(0);
  });
});

describeDb("second-factor rotation (lost/compromised authenticator)", () => {
  it("replaces the secret only after the NEW code is proved", async () => {
    const { user, secret } = await enrolledUser();
    const { secret: pending } = await beginTwoFactorRotation(
      user.id,
      generateTotp(secret),
    );
    expect(pending).not.toBe(secret);

    // Mid-rotation: the OLD authenticator still works, so a privileged account
    // is never locked out while the new app is being set up.
    expect(await verifySecondFactor(user.id, generateTotp(secret, new Date(Date.now() + 30_000)))).toBe(true);
    expect((await twoFactorStatus(user.id)).rotationStarted).toBe(true);

    const { recoveryCodes } = await confirmTwoFactorRotation(
      user.id,
      generateTotp(pending),
    );
    expect(recoveryCodes.length).toBeGreaterThan(0);

    // After promotion the OLD authenticator no longer opens the door (checked
    // first, so the replay guard cannot be what rejects it) and the NEW one does.
    // Codes are only valid within one step, hence +30 s and not further.
    const nextStep = new Date(Date.now() + 30_000);
    expect(await verifySecondFactor(user.id, generateTotp(secret, nextStep))).toBe(false);
    expect(await verifySecondFactor(user.id, generateTotp(pending, nextStep))).toBe(true);
    expect((await twoFactorStatus(user.id)).rotationStarted).toBe(false);
  });

  it("invalidates the previous recovery codes", async () => {
    const { user, secret } = await enrolledUser();
    const { secret: pending } = await beginTwoFactorRotation(user.id, generateTotp(secret));
    await confirmTwoFactorRotation(user.id, generateTotp(pending));
    // An old recovery code from the compromised enrolment must not work.
    expect(await verifySecondFactor(user.id, RECOVERY[0])).toBe(false);
  });

  it("refuses to start without a valid current factor, and accepts a recovery code", async () => {
    const { user, secret } = await enrolledUser();
    await expect(beginTwoFactorRotation(user.id, "000000")).rejects.toThrow(/valid current code/);
    // A recovery code is the documented path when the authenticator is gone.
    const started = await beginTwoFactorRotation(user.id, RECOVERY[1]);
    expect(started.secret).not.toBe(secret);
  });

  it("cancels cleanly, leaving the active authenticator untouched", async () => {
    const { user, secret } = await enrolledUser();
    await beginTwoFactorRotation(user.id, generateTotp(secret));
    await cancelTwoFactorRotation(user.id);
    expect((await twoFactorStatus(user.id)).rotationStarted).toBe(false);
    expect(await verifySecondFactor(user.id, generateTotp(secret, new Date(Date.now() + 30_000)))).toBe(true);
  });

  it("is available to roles that may never disable 2FA", async () => {
    const { user, secret } = await enrolledUser();
    for (const role of ["ADMIN", "SUPERVISOR", "AUDITOR"] as const) {
      expect(roleRequiresTwoFactor(role)).toBe(true);
      await expect(disableTwoFactor(user.id, generateTotp(secret), role)).rejects.toThrow(
        /cannot be turned off/,
      );
    }
    // …but rotation works for exactly those accounts.
    const { secret: pending } = await beginTwoFactorRotation(
      user.id,
      generateTotp(secret, new Date(Date.now() + 30_000)),
    );
    await confirmTwoFactorRotation(user.id, generateTotp(pending));
    expect(
      await verifySecondFactor(user.id, generateTotp(pending, new Date(Date.now() + 30_000))),
    ).toBe(true);
  });
});
