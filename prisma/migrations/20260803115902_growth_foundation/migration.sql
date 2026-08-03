-- CreateEnum
CREATE TYPE "TargetProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GrowthAccountStatus" AS ENUM ('IMPORTED', 'NEEDS_REVIEW', 'READY_FOR_RESEARCH', 'RESEARCHING', 'READY_FOR_ASSESSMENT', 'APPROVED', 'REJECTED', 'DRAFT_PREPARED', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'MEETING_BOOKED', 'NOT_NOW', 'SUPPRESSED', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "EvidenceClassification" AS ENUM ('VERIFIED_FACT', 'INFERENCE', 'HYPOTHESIS');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GrowthDraftStatus" AS ENUM ('DRAFT', 'AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'MANUALLY_SENT', 'CANCELLED');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "growthAccountId" TEXT;

-- CreateTable
CREATE TABLE "TargetProfile" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "industries" TEXT[],
    "regions" TEXT[],
    "companySizeMin" INTEGER,
    "companySizeMax" INTEGER,
    "characteristics" TEXT[],
    "decisionMakerRoles" TEXT[],
    "positiveSignals" TEXT[],
    "negativeSignals" TEXT[],
    "exclusionCriteria" TEXT[],
    "operantoUseCases" TEXT[],
    "languages" TEXT[],
    "scoringWeights" JSONB,
    "status" "TargetProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthAccount" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "targetProfileId" TEXT,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "tradingName" TEXT,
    "domain" TEXT,
    "domainNormalized" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "employeeEstimate" INTEGER,
    "description" TEXT,
    "phone" TEXT,
    "publicEmail" TEXT,
    "status" "GrowthAccountStatus" NOT NULL DEFAULT 'IMPORTED',
    "ownerMembershipId" TEXT,
    "customerId" TEXT,
    "lastResearchedAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthContact" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT,
    "seniority" TEXT,
    "department" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "phone" TEXT,
    "language" TEXT,
    "profileUrl" TEXT,
    "source" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL DEFAULT 'b2b_prospecting',
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "confidence" DOUBLE PRECISION,
    "suppressedAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSourceRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRecordId" TEXT,
    "sourceUrl" TEXT,
    "importBatchId" TEXT,
    "rawPayload" JSONB,
    "payloadRedactedAt" TIMESTAMP(3),
    "duplicateOfAccountId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByMembershipId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "costCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchEvidence" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "researchRunId" TEXT,
    "category" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "classification" "EvidenceClassification" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "excerpt" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "provider" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountScore" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "aiScore" INTEGER,
    "aiComponents" JSONB,
    "aiExplanation" TEXT,
    "aiModel" TEXT,
    "aiPromptVersion" TEXT,
    "humanScore" INTEGER,
    "humanReason" TEXT,
    "adjustedByMembershipId" TEXT,
    "confidence" DOUBLE PRECISION,
    "missingData" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBrief" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sections" JSONB NOT NULL,
    "evidenceIds" TEXT[],
    "generatedByModel" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachPlaybook" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "targetProfileId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "valuePropositions" TEXT[],
    "approvedClaims" TEXT[],
    "prohibitedClaims" TEXT[],
    "tone" TEXT,
    "callToAction" TEXT,
    "lengthGuidance" TEXT,
    "requiredFooter" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "playbookId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "callToAction" TEXT,
    "evidenceIds" TEXT[],
    "promptVersion" TEXT,
    "model" TEXT,
    "status" "GrowthDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMembershipId" TEXT,
    "approvedByMembershipId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "manuallySentAt" TIMESTAMP(3),
    "manualChannel" TEXT,
    "externalMessageRef" TEXT,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraftVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachDraftVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "emailNormalized" TEXT,
    "domainNormalized" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetProfile_organisationId_status_idx" ON "TargetProfile"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TargetProfile_organisationId_name_key" ON "TargetProfile"("organisationId", "name");

-- CreateIndex
CREATE INDEX "GrowthAccount_organisationId_status_idx" ON "GrowthAccount"("organisationId", "status");

-- CreateIndex
CREATE INDEX "GrowthAccount_organisationId_nameNormalized_idx" ON "GrowthAccount"("organisationId", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthAccount_organisationId_domainNormalized_key" ON "GrowthAccount"("organisationId", "domainNormalized");

-- CreateIndex
CREATE INDEX "GrowthContact_organisationId_accountId_idx" ON "GrowthContact"("organisationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthContact_organisationId_accountId_emailNormalized_key" ON "GrowthContact"("organisationId", "accountId", "emailNormalized");

-- CreateIndex
CREATE INDEX "AccountSourceRecord_organisationId_accountId_idx" ON "AccountSourceRecord"("organisationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSourceRecord_organisationId_provider_providerRecordI_key" ON "AccountSourceRecord"("organisationId", "provider", "providerRecordId");

-- CreateIndex
CREATE INDEX "ResearchRun_organisationId_accountId_idx" ON "ResearchRun"("organisationId", "accountId");

-- CreateIndex
CREATE INDEX "ResearchEvidence_organisationId_accountId_idx" ON "ResearchEvidence"("organisationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountScore_accountId_key" ON "AccountScore"("accountId");

-- CreateIndex
CREATE INDEX "AccountScore_organisationId_idx" ON "AccountScore"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBrief_organisationId_accountId_version_key" ON "AccountBrief"("organisationId", "accountId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachPlaybook_organisationId_name_key" ON "OutreachPlaybook"("organisationId", "name");

-- CreateIndex
CREATE INDEX "OutreachDraft_organisationId_accountId_idx" ON "OutreachDraft"("organisationId", "accountId");

-- CreateIndex
CREATE INDEX "OutreachDraft_organisationId_status_idx" ON "OutreachDraft"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDraftVersion_draftId_version_key" ON "OutreachDraftVersion"("draftId", "version");

-- CreateIndex
CREATE INDEX "SuppressionEntry_organisationId_domainNormalized_idx" ON "SuppressionEntry"("organisationId", "domainNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_organisationId_emailNormalized_key" ON "SuppressionEntry"("organisationId", "emailNormalized");

-- AddForeignKey
ALTER TABLE "TargetProfile" ADD CONSTRAINT "TargetProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthAccount" ADD CONSTRAINT "GrowthAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthAccount" ADD CONSTRAINT "GrowthAccount_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "TargetProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthContact" ADD CONSTRAINT "GrowthContact_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthContact" ADD CONSTRAINT "GrowthContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSourceRecord" ADD CONSTRAINT "AccountSourceRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSourceRecord" ADD CONSTRAINT "AccountSourceRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountScore" ADD CONSTRAINT "AccountScore_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountScore" ADD CONSTRAINT "AccountScore_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBrief" ADD CONSTRAINT "AccountBrief_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBrief" ADD CONSTRAINT "AccountBrief_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPlaybook" ADD CONSTRAINT "OutreachPlaybook_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPlaybook" ADD CONSTRAINT "OutreachPlaybook_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "TargetProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "OutreachPlaybook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraftVersion" ADD CONSTRAINT "OutreachDraftVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraftVersion" ADD CONSTRAINT "OutreachDraftVersion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OutreachDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

