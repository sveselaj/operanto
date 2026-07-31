-- Replay guard: remember the highest TOTP counter already accepted, so a code
-- cannot be used twice within its validity window.
ALTER TABLE "User" ADD COLUMN "totpLastCounter" BIGINT;
