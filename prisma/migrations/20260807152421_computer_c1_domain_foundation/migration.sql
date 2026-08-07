-- CreateEnum
CREATE TYPE "ComputerSessionStatus" AS ENUM ('CREATED', 'PLANNING', 'READY', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComputerPlanStatus" AS ENUM ('PROPOSED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComputerStepRoute" AS ENUM ('NATIVE_TOOL', 'CONNECTOR', 'COMPUTER', 'HUMAN', 'NONE');

-- CreateEnum
CREATE TYPE "ComputerActionType" AS ENUM ('OBSERVE', 'NAVIGATE', 'CLICK', 'TYPE', 'SELECT', 'SCROLL', 'EXTRACT', 'DOWNLOAD', 'UPLOAD', 'SUBMIT');

-- CreateEnum
CREATE TYPE "ComputerRiskTier" AS ENUM ('R0_OBSERVE', 'R1_NAVIGATE', 'R2_PREPARE', 'R3_COMMIT', 'R4_RESTRICTED');

-- CreateEnum
CREATE TYPE "ComputerActionStatus" AS ENUM ('PROPOSED', 'APPROVAL_PENDING', 'APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComputerVerificationResult" AS ENUM ('NOT_RUN', 'VERIFIED', 'FAILED', 'INCONCLUSIVE');

-- AlterEnum
ALTER TYPE "ApprovalSourceType" ADD VALUE 'COMPUTER_ACTION';

-- CreateTable
CREATE TABLE "ComputerSession" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdByMembershipId" TEXT,
    "conversationId" TEXT,
    "customerId" TEXT,
    "taskId" TEXT,
    "goal" TEXT NOT NULL,
    "status" "ComputerSessionStatus" NOT NULL DEFAULT 'CREATED',
    "outcomeNote" TEXT,
    "redactedAt" TIMESTAMP(3),
    "concludedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerPlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ComputerPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "summary" TEXT NOT NULL,
    "aiActionId" TEXT,
    "createdByMembershipId" TEXT,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerStep" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "plannedRoute" "ComputerStepRoute" NOT NULL,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT,
    "actionType" "ComputerActionType" NOT NULL,
    "riskTier" "ComputerRiskTier" NOT NULL,
    "status" "ComputerActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "reason" TEXT NOT NULL,
    "targetJson" JSONB,
    "confidence" DOUBLE PRECISION,
    "proposedByMembershipId" TEXT,
    "aiActionId" TEXT,
    "beforeSnapshotId" TEXT,
    "afterSnapshotId" TEXT,
    "verificationResult" "ComputerVerificationResult" NOT NULL DEFAULT 'NOT_RUN',
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordedByMembershipId" TEXT,
    "url" TEXT,
    "pageTitle" TEXT,
    "visibleTextSummary" TEXT,
    "semanticJson" JSONB,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComputerSession_organisationId_status_createdAt_idx" ON "ComputerSession"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ComputerSession_organisationId_customerId_idx" ON "ComputerSession"("organisationId", "customerId");

-- CreateIndex
CREATE INDEX "ComputerSession_conversationId_idx" ON "ComputerSession"("conversationId");

-- CreateIndex
CREATE INDEX "ComputerPlan_organisationId_sessionId_idx" ON "ComputerPlan"("organisationId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ComputerPlan_sessionId_version_key" ON "ComputerPlan"("sessionId", "version");

-- CreateIndex
CREATE INDEX "ComputerStep_organisationId_planId_idx" ON "ComputerStep"("organisationId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "ComputerStep_planId_position_key" ON "ComputerStep"("planId", "position");

-- CreateIndex
CREATE INDEX "ComputerAction_organisationId_sessionId_createdAt_idx" ON "ComputerAction"("organisationId", "sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ComputerAction_organisationId_status_idx" ON "ComputerAction"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ComputerAction_stepId_idx" ON "ComputerAction"("stepId");

-- CreateIndex
CREATE INDEX "ComputerSnapshot_organisationId_sessionId_createdAt_idx" ON "ComputerSnapshot"("organisationId", "sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ComputerSession" ADD CONSTRAINT "ComputerSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSession" ADD CONSTRAINT "ComputerSession_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSession" ADD CONSTRAINT "ComputerSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSession" ADD CONSTRAINT "ComputerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSession" ADD CONSTRAINT "ComputerSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerPlan" ADD CONSTRAINT "ComputerPlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerPlan" ADD CONSTRAINT "ComputerPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ComputerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerPlan" ADD CONSTRAINT "ComputerPlan_aiActionId_fkey" FOREIGN KEY ("aiActionId") REFERENCES "AIAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerPlan" ADD CONSTRAINT "ComputerPlan_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerStep" ADD CONSTRAINT "ComputerStep_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerStep" ADD CONSTRAINT "ComputerStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ComputerPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ComputerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ComputerStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_proposedByMembershipId_fkey" FOREIGN KEY ("proposedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_aiActionId_fkey" FOREIGN KEY ("aiActionId") REFERENCES "AIAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_beforeSnapshotId_fkey" FOREIGN KEY ("beforeSnapshotId") REFERENCES "ComputerSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerAction" ADD CONSTRAINT "ComputerAction_afterSnapshotId_fkey" FOREIGN KEY ("afterSnapshotId") REFERENCES "ComputerSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSnapshot" ADD CONSTRAINT "ComputerSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSnapshot" ADD CONSTRAINT "ComputerSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ComputerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerSnapshot" ADD CONSTRAINT "ComputerSnapshot_recordedByMembershipId_fkey" FOREIGN KEY ("recordedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
