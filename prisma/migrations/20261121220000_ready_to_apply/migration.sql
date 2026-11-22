-- Approved as Ready to apply, and the ATS score it had then.
ALTER TABLE "Application" ADD COLUMN "readyAt" TIMESTAMP(3), ADD COLUMN "readyGrade" INTEGER;
