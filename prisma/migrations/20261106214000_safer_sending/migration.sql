-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "sendingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "replyTo" TEXT NOT NULL DEFAULT '';
