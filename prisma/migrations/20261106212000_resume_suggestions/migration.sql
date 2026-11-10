-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "resumeSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[];
