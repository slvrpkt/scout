-- The Apply queue was taken out: its two columns go.
ALTER TABLE "Application" DROP COLUMN "readyAt", DROP COLUMN "readyGrade";
