-- AlterTable
ALTER TABLE "ComputerAction" ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "executionClaimedAt" TIMESTAMP(3),
ADD COLUMN     "executionError" TEXT,
ADD COLUMN     "executionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "executionNonceHash" TEXT,
ADD COLUMN     "expectedHref" TEXT,
ADD COLUMN     "expectedOrigin" TEXT,
ADD COLUMN     "targetRef" TEXT;

-- AlterTable
ALTER TABLE "ComputerSnapshot" ADD COLUMN     "safeLinksJson" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "ComputerAction_executionNonceHash_key" ON "ComputerAction"("executionNonceHash");

