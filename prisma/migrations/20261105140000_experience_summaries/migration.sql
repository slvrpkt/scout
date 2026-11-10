-- CreateTable
CREATE TABLE "ExperienceSummary" (
    "experienceId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "bullets" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperienceSummary_pkey" PRIMARY KEY ("experienceId","count")
);

-- AddForeignKey
ALTER TABLE "ExperienceSummary" ADD CONSTRAINT "ExperienceSummary_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

