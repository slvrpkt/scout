-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "resumeTextSize" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "SentDocument" ADD COLUMN     "textSize" INTEGER;
