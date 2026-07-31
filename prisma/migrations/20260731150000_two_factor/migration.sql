-- Two-factor authentication (TOTP) with single-use recovery codes.
-- Additive: existing users have 2FA inactive until they enrol.
ALTER TABLE "User" ADD COLUMN "totpSecretEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN "totpConfirmedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
