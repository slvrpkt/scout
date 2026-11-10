-- CreateEnum
CREATE TYPE "FileFormat" AS ENUM ('PDF', 'DOCX');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "driveFolderId" TEXT,
ADD COLUMN     "drivePostingFileId" TEXT,
ADD COLUMN     "driveProblem" TEXT,
ADD COLUMN     "lastDownloadFormat" "FileFormat";

-- AlterTable
ALTER TABLE "SentDocument" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "format" "FileFormat" NOT NULL DEFAULT 'PDF';

