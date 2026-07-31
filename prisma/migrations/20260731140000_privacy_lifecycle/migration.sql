-- Privacy lifecycle: erasure, restriction of processing, and retention of raw
-- event payloads. Additive only — no existing column is altered or dropped,
-- and no data is rewritten by the migration itself.
ALTER TABLE "Customer" ADD COLUMN "erasedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "restrictedAt" TIMESTAMP(3);
ALTER TABLE "InboundEvent" ADD COLUMN "payloadRedactedAt" TIMESTAMP(3);

-- The retention sweep looks for un-redacted payloads past their age limit.
CREATE INDEX "InboundEvent_payloadRedactedAt_receivedAt_idx"
  ON "InboundEvent"("payloadRedactedAt", "receivedAt");

-- Erased and restricted customers are filtered on almost every read.
CREATE INDEX "Customer_organisationId_erasedAt_idx"
  ON "Customer"("organisationId", "erasedAt");
