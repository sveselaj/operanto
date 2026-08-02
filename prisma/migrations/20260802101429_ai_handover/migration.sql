-- CreateEnum
CREATE TYPE "ConversationHandling" AS ENUM ('AI_ASSISTED', 'HUMAN_CONTROLLED');

-- CreateEnum
CREATE TYPE "AITaskType" AS ENUM ('SUMMARY', 'CLASSIFICATION', 'REPLY_DRAFT', 'NEXT_ACTION');

-- CreateEnum
CREATE TYPE "AIActionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REJECTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AIRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AIMode" AS ENUM ('MOCK', 'LIVE');

-- CreateEnum
CREATE TYPE "ApprovalSourceType" AS ENUM ('AI_REPLY_DRAFT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "handling" "ConversationHandling" NOT NULL DEFAULT 'AI_ASSISTED',
ADD COLUMN     "handlingChangedAt" TIMESTAMP(3),
ADD COLUMN     "handlingChangedByMembershipId" TEXT;

-- CreateTable
CREATE TABLE "AIAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerId" TEXT,
    "requestedByMembershipId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "taskType" "AITaskType" NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "AIActionStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "riskLevel" "AIRiskLevel",
    "inputSummary" JSONB,
    "outputJson" JSONB,
    "usageJson" JSONB,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceType" "ApprovalSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByMembershipId" TEXT,
    "assignedReviewerMembershipId" TEXT,
    "decidedByMembershipId" TEXT,
    "originalPayload" JSONB NOT NULL,
    "editedPayload" JSONB,
    "decisionReason" TEXT,
    "riskLevel" "AIRiskLevel" NOT NULL,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "executionClaimedAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConfiguration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "AIMode" NOT NULL DEFAULT 'MOCK',
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "monthlyRequestLimit" INTEGER NOT NULL DEFAULT 200,
    "monthlyTokenLimit" INTEGER,
    "monthlyCostLimitCents" INTEGER,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodRequestCount" INTEGER NOT NULL DEFAULT 0,
    "periodTokenCount" INTEGER NOT NULL DEFAULT 0,
    "periodEstimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "permittedTaskTypes" "AITaskType"[] DEFAULT ARRAY['SUMMARY', 'CLASSIFICATION', 'REPLY_DRAFT', 'NEXT_ACTION']::"AITaskType"[],
    "confidencePolicyVersion" TEXT NOT NULL DEFAULT 'v1',
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIAction_organisationId_conversationId_createdAt_idx" ON "AIAction"("organisationId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIAction_organisationId_createdAt_idx" ON "AIAction"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIAction_organisationId_redactedAt_createdAt_idx" ON "AIAction"("organisationId", "redactedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organisationId_status_requestedAt_idx" ON "ApprovalRequest"("organisationId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_conversationId_idx" ON "ApprovalRequest"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_organisationId_idempotencyKey_key" ON "ApprovalRequest"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_organisationId_sourceType_sourceId_key" ON "ApprovalRequest"("organisationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AiConfiguration_organisationId_key" ON "AiConfiguration"("organisationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_handlingChangedByMembershipId_fkey" FOREIGN KEY ("handlingChangedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAction" ADD CONSTRAINT "AIAction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAction" ADD CONSTRAINT "AIAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAction" ADD CONSTRAINT "AIAction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAction" ADD CONSTRAINT "AIAction_requestedByMembershipId_fkey" FOREIGN KEY ("requestedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedByMembershipId_fkey" FOREIGN KEY ("requestedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_assignedReviewerMembershipId_fkey" FOREIGN KEY ("assignedReviewerMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedByMembershipId_fkey" FOREIGN KEY ("decidedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConfiguration" ADD CONSTRAINT "AiConfiguration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
