-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('MANUAL', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ConversationParticipantType" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('RECORDED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "conversationId" TEXT;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "messageRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT,
    "channelConnectionId" TEXT,
    "channelType" "ChannelType" NOT NULL DEFAULT 'MANUAL',
    "providerThreadId" TEXT,
    "subject" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedMembershipId" TEXT,
    "createdByMembershipId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "ConversationParticipantType" NOT NULL,
    "customerId" TEXT,
    "membershipId" TEXT,
    "displayName" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelConnectionId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "senderMembershipId" TEXT,
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "providerTimestamp" TIMESTAMP(3),
    "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'RECORDED',
    "metadata" JSONB,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorMembershipId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_organisationId_idx" ON "ChannelConnection"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_organisationId_type_displayName_key" ON "ChannelConnection"("organisationId", "type", "displayName");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_lastMessageAt_idx" ON "Conversation"("organisationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_status_lastMessageAt_idx" ON "Conversation"("organisationId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_assignedMembershipId_idx" ON "Conversation"("organisationId", "assignedMembershipId");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_customerId_idx" ON "Conversation"("organisationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organisationId_channelConnectionId_providerThr_key" ON "Conversation"("organisationId", "channelConnectionId", "providerThreadId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_organisationId_customerId_idx" ON "ConversationParticipant"("organisationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_organisationId_conversationId_custo_key" ON "ConversationParticipant"("organisationId", "conversationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_organisationId_conversationId_membe_key" ON "ConversationParticipant"("organisationId", "conversationId", "membershipId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_organisationId_redactedAt_createdAt_idx" ON "Message"("organisationId", "redactedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_organisationId_channelConnectionId_providerMessageI_key" ON "Message"("organisationId", "channelConnectionId", "providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationNote_conversationId_createdAt_idx" ON "ConversationNote"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_conversationId_occurredAt_idx" ON "Activity"("conversationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "ChannelConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "ChannelConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderMembershipId_fkey" FOREIGN KEY ("senderMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_authorMembershipId_fkey" FOREIGN KEY ("authorMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
