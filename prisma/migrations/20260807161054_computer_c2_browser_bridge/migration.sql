-- CreateEnum
CREATE TYPE "ComputerBridgeStatus" AS ENUM ('PENDING', 'ATTACHED', 'DETACHED', 'REVOKED');

-- AlterTable
ALTER TABLE "ComputerSnapshot" ADD COLUMN     "bridgeId" TEXT,
ADD COLUMN     "clientCaptureId" TEXT;

-- CreateTable
CREATE TABLE "ComputerBridgeGrant" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdByMembershipId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "ComputerBridgeStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attachedAt" TIMESTAMP(3),
    "detachedAt" TIMESTAMP(3),
    "lastCaptureAt" TIMESTAMP(3),
    "captureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerBridgeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComputerBridgeGrant_tokenHash_key" ON "ComputerBridgeGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "ComputerBridgeGrant_organisationId_sessionId_status_idx" ON "ComputerBridgeGrant"("organisationId", "sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComputerSnapshot_bridgeId_clientCaptureId_key" ON "ComputerSnapshot"("bridgeId", "clientCaptureId");

-- AddForeignKey
ALTER TABLE "ComputerSnapshot" ADD CONSTRAINT "ComputerSnapshot_bridgeId_fkey" FOREIGN KEY ("bridgeId") REFERENCES "ComputerBridgeGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerBridgeGrant" ADD CONSTRAINT "ComputerBridgeGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerBridgeGrant" ADD CONSTRAINT "ComputerBridgeGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ComputerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerBridgeGrant" ADD CONSTRAINT "ComputerBridgeGrant_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

