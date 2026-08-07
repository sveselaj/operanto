ALTER TABLE "AIAction" ADD COLUMN     "computerSessionId" TEXT,
ADD COLUMN     "computerSnapshotId" TEXT;

-- AlterTable
ALTER TABLE "AiConfiguration" ALTER COLUMN "permittedTaskTypes" SET DEFAULT ARRAY['SUMMARY', 'CLASSIFICATION', 'REPLY_DRAFT', 'NEXT_ACTION', 'COMPUTER_PAGE_UNDERSTAND', 'COMPUTER_GUIDE']::"AITaskType"[];

-- CreateIndex
CREATE INDEX "AIAction_computerSessionId_idx" ON "AIAction"("computerSessionId");

-- AddForeignKey
ALTER TABLE "AIAction" ADD CONSTRAINT "AIAction_computerSessionId_fkey" FOREIGN KEY ("computerSessionId") REFERENCES "ComputerSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAction" ADD CONSTRAINT "AIAction_computerSnapshotId_fkey" FOREIGN KEY ("computerSnapshotId") REFERENCES "ComputerSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

