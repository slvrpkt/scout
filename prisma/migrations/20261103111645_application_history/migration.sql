-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'INTERVIEW', 'MEETING', 'UPDATE');

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "kind" "NoteKind" NOT NULL DEFAULT 'NOTE';

-- Notes written before kept their order: they happened when they were written.
UPDATE "Note" SET "at" = "createdAt";

-- CreateTable
CREATE TABLE "SentDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "units" JSONB NOT NULL,
    "themeId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentDocument_applicationId_sentAt_idx" ON "SentDocument"("applicationId", "sentAt");

-- CreateIndex
CREATE INDEX "SentDocument_sentAt_idx" ON "SentDocument"("sentAt");

-- CreateIndex
CREATE INDEX "Note_at_idx" ON "Note"("at");

-- AddForeignKey
ALTER TABLE "SentDocument" ADD CONSTRAINT "SentDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentDocument" ADD CONSTRAINT "SentDocument_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StatusEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentDocument" ADD CONSTRAINT "SentDocument_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

