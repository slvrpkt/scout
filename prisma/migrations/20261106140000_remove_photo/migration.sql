-- AlterTable
ALTER TABLE "Application" DROP COLUMN "showPhoto";

-- AlterTable
ALTER TABLE "Theme" DROP COLUMN "photoPosition",
DROP COLUMN "photoShape";

-- DropEnum
DROP TYPE "PhotoPosition";

-- DropEnum
DROP TYPE "PhotoShape";

