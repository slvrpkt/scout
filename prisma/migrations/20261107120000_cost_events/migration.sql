-- CreateTable
CREATE TABLE "CostEvent" (
    "id" TEXT NOT NULL,
    "center" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEvent_at_idx" ON "CostEvent"("at");
