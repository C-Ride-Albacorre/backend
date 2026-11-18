/*
  Warnings:

  - Added the required column `jobRequirement` to the `vacancies` table without a default value. This is not possible if the table is not empty.
  - Added the required column `salaryPeriod` to the `vacancies` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "vacancies" ADD COLUMN     "jobRequirement" TEXT NOT NULL,
ADD COLUMN     "salaryPeriod" "SalaryPeriod" NOT NULL;
