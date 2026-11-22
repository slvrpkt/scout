-- How many times a job was picked up again after Scout restarted mid-way.
ALTER TABLE "Job" ADD COLUMN "resumes" INTEGER NOT NULL DEFAULT 0;
