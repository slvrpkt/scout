-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "appliedVia" TEXT,
ADD COLUMN     "thingsToNote" TEXT NOT NULL DEFAULT '';

