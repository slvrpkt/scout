-- CreateEnum
CREATE TYPE "EmployerType" AS ENUM ('GOVERNMENT', 'STARTUP', 'PRIVATE');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "employerType" "EmployerType";
