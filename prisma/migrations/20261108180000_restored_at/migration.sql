-- When an application or a posting was put back from the Archive.
ALTER TABLE "Application" ADD COLUMN "restoredAt" TIMESTAMP(3);
ALTER TABLE "AgentCandidate" ADD COLUMN "restoredAt" TIMESTAMP(3);
