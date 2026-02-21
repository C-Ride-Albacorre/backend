/*
  Warnings:

  - Added the required column `registrationNumber` to the `BusinessInfo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taxId` to the `BusinessInfo` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BusinessInfo" ADD COLUMN     "registrationNumber" TEXT NOT NULL,
ADD COLUMN     "taxId" TEXT NOT NULL;
