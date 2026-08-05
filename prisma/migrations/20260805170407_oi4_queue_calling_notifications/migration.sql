-- CreateEnum
CREATE TYPE "CallAttemptStatus" AS ENUM ('LAUNCHED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER', 'UNAVAILABLE', 'CALLBACK_REQUESTED', 'APPOINTMENT_BOOKED', 'QUALIFIED', 'REJECTED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "LockReleaseReason" AS ENUM ('COMPLETED', 'NEXT', 'EXIT', 'LOGOUT', 'EXPIRED', 'OVERRIDDEN');

-- CreateTable
CREATE TABLE "CallAttempt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "membershipId" TEXT,
    "provider" TEXT NOT NULL,
    "dialedNumber" TEXT NOT NULL,
    "rawPhone" TEXT,
    "status" "CallAttemptStatus" NOT NULL DEFAULT 'LAUNCHED',
    "outcome" "CallOutcome",
    "outcomeRecordedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "durationSource" TEXT,
    "note" TEXT,
    "cancelReason" TEXT,
    "activityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadWorkLock" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" "LockReleaseReason",

    CONSTRAINT "LeadWorkLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallAttempt_organisationId_status_createdAt_idx" ON "CallAttempt"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CallAttempt_leadId_createdAt_idx" ON "CallAttempt"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadWorkLock_leadId_releasedAt_idx" ON "LeadWorkLock"("leadId", "releasedAt");

-- CreateIndex
CREATE INDEX "LeadWorkLock_organisationId_membershipId_releasedAt_idx" ON "LeadWorkLock"("organisationId", "membershipId", "releasedAt");

-- CreateIndex
CREATE INDEX "Notification_membershipId_readAt_createdAt_idx" ON "Notification"("membershipId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_membershipId_type_entityId_dedupeKey_key" ON "Notification"("membershipId", "type", "entityId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "CallAttempt" ADD CONSTRAINT "CallAttempt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAttempt" ADD CONSTRAINT "CallAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAttempt" ADD CONSTRAINT "CallAttempt_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWorkLock" ADD CONSTRAINT "LeadWorkLock_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWorkLock" ADD CONSTRAINT "LeadWorkLock_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWorkLock" ADD CONSTRAINT "LeadWorkLock_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most ONE active work lock per lead. Prisma cannot express a partial
-- unique index, so it is added by hand here — keep it when editing this
-- migration. Without it, two agents can hold the same lead concurrently and
-- the queue's exclusion rule becomes advisory.
CREATE UNIQUE INDEX "LeadWorkLock_leadId_active_key"
  ON "LeadWorkLock"("leadId")
  WHERE "releasedAt" IS NULL;
