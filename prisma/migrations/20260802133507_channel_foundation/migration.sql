-- CreateEnum
CREATE TYPE "ChannelEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastReceivedAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChannelInboundEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "payloadRedactedAt" TIMESTAMP(3),
    "status" "ChannelEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "conversationId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT NOT NULL,
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelInboundEvent_organisationId_status_receivedAt_idx" ON "ChannelInboundEvent"("organisationId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "ChannelInboundEvent_organisationId_conversationId_idx" ON "ChannelInboundEvent"("organisationId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInboundEvent_channelConnectionId_dedupeKey_key" ON "ChannelInboundEvent"("channelConnectionId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Consent_organisationId_customerId_idx" ON "Consent"("organisationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_organisationId_customerId_channelType_key" ON "Consent"("organisationId", "customerId", "channelType");

-- AddForeignKey
ALTER TABLE "ChannelInboundEvent" ADD CONSTRAINT "ChannelInboundEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundEvent" ADD CONSTRAINT "ChannelInboundEvent_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundEvent" ADD CONSTRAINT "ChannelInboundEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_updatedByMembershipId_fkey" FOREIGN KEY ("updatedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
