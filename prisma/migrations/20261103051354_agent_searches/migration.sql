-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN     "searchId" TEXT;

-- CreateTable
CREATE TABLE "AgentSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSearch_position_idx" ON "AgentSearch"("position");

-- CreateIndex
CREATE INDEX "AgentCandidate_searchId_idx" ON "AgentCandidate"("searchId");

-- AddForeignKey
ALTER TABLE "AgentCandidate" ADD CONSTRAINT "AgentCandidate_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "AgentSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The one search the agent had before becomes its first saved search.
INSERT INTO "AgentSearch" ("id", "name", "query", "enabled", "position", "createdAt", "updatedAt")
SELECT 'agent-search-1', trim("value"::jsonb->>'keywords'), "value"::jsonb, true, 0, now(), now()
FROM "Setting"
WHERE "key" = 'agentQuery'
  AND "value" ~ '^\s*\{'
  AND coalesce(trim("value"::jsonb->>'keywords'), '') <> '';
