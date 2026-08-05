-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'NO_ANSWER_1', 'NO_ANSWER_2', 'NO_ANSWER_3', 'RETRY_LATER', 'CALLBACK', 'APPOINTMENT', 'QUALIFIED', 'CONVERTED', 'REJECTED', 'LOST', 'WRONG_NUMBER', 'UNAVAILABLE', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "LeadPhoneStatus" AS ENUM ('MISSING', 'VALID', 'POSSIBLE', 'INVALID');

-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'AUDITOR';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "leadId" TEXT;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "phoneCountry" TEXT,
    "phoneNational" TEXT,
    "phoneExtension" TEXT,
    "phoneStatus" "LeadPhoneStatus" NOT NULL DEFAULT 'MISSING',
    "secondaryPhone" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "origin" TEXT NOT NULL,
    "source" TEXT,
    "externalReference" TEXT,
    "dataOrigin" TEXT,
    "estimatedValue" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "rejectionReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "assignedMembershipId" TEXT,
    "createdByMembershipId" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "callbackAt" TIMESTAMP(3),
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStatusHistory" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "previousStatus" "LeadStatus",
    "newStatus" "LeadStatus" NOT NULL,
    "changedByMembershipId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_organisationId_status_idx" ON "Lead"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Lead_organisationId_assignedMembershipId_idx" ON "Lead"("organisationId", "assignedMembershipId");

-- CreateIndex
CREATE INDEX "Lead_organisationId_phoneNormalized_idx" ON "Lead"("organisationId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "Lead_organisationId_emailNormalized_idx" ON "Lead"("organisationId", "emailNormalized");

-- CreateIndex
CREATE INDEX "Lead_organisationId_nextActionAt_idx" ON "Lead"("organisationId", "nextActionAt");

-- CreateIndex
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

-- CreateIndex
CREATE INDEX "LeadStatusHistory_leadId_createdAt_idx" ON "LeadStatusHistory"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_leadId_occurredAt_idx" ON "Activity"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "Task_leadId_idx" ON "Task"("leadId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_changedByMembershipId_fkey" FOREIGN KEY ("changedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
