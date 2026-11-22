-- Find it on the company's site: the company's website, and what the agent found there.
ALTER TABLE "AgentCandidate" ADD COLUMN "employerSite" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentCandidate" ADD COLUMN "sourceCheck" TEXT;
ALTER TABLE "AgentCandidate" ADD COLUMN "sourceCheckedAt" TIMESTAMP(3);
ALTER TABLE "AgentCandidate" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "AgentCandidate" ADD COLUMN "boardDescription" TEXT;
