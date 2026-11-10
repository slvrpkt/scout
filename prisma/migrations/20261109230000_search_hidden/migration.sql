-- How many postings a search's filters hid.
ALTER TABLE "PostingSearch" ADD COLUMN "hidden" INTEGER NOT NULL DEFAULT 0;
