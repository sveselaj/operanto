-- CreateEnum
CREATE TYPE "GrowthImportStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'FAILED');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "growthAccountId" TEXT;

-- CreateTable
CREATE TABLE "GrowthImport" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdByMembershipId" TEXT,
    "filename" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "status" "GrowthImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "suppressedCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GrowthImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrowthImport_organisationId_createdAt_idx" ON "GrowthImport"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_growthAccountId_fkey" FOREIGN KEY ("growthAccountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_growthAccountId_fkey" FOREIGN KEY ("growthAccountId") REFERENCES "GrowthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthImport" ADD CONSTRAINT "GrowthImport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

