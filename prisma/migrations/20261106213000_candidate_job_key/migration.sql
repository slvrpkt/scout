-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN     "jobKey" TEXT;

-- CreateIndex
CREATE INDEX "AgentCandidate_jobKey_idx" ON "AgentCandidate"("jobKey");
