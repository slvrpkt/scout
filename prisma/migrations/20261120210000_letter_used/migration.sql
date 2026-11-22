-- A cover letter never used is not counted as sent with its application.
ALTER TABLE "Application" ADD COLUMN "letterUsedAt" TIMESTAMP(3);
ALTER TABLE "StatusEvent" ADD COLUMN "droppedLetter" BOOLEAN NOT NULL DEFAULT false;
