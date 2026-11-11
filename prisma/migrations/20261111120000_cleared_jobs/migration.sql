-- CreateTable
CREATE TABLE "ClearedJob" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearedJob_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ClearedJob_createdAt_idx" ON "ClearedJob"("createdAt");
