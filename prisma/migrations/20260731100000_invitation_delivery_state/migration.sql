-- Invitation delivery state. Additive: existing invitations keep working and
-- simply have no delivery record.
ALTER TABLE "Invitation" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Invitation" ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invitation" ADD COLUMN "lastDeliveryError" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "revokedAt" TIMESTAMP(3);
