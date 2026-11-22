-- The inbox: read or unread, and important.
ALTER TABLE "EmailMessage" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN "important" BOOLEAN NOT NULL DEFAULT false;
