-- CreateTable
CREATE TABLE "QueuedPosting" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "posting" JSONB NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueuedPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueuedPosting_jobKey_key" ON "QueuedPosting"("jobKey");

-- CreateIndex
CREATE INDEX "QueuedPosting_batchId_idx" ON "QueuedPosting"("batchId");
