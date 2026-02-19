/*
  Warnings:

  - You are about to drop the column `logoUrl` on the `BusinessInfo` table. All the data in the column will be lost.
  - You are about to drop the column `openingHours` on the `BusinessInfo` table. All the data in the column will be lost.
  - You are about to drop the column `shortDesc` on the `BusinessInfo` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `BusinessInfo` table. All the data in the column will be lost.
  - The `documentType` column on the `VendorDocument` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[userId,provider]` on the table `OAuthProvider` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `accountName` to the `BusinessInfo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountNumber` to the `BusinessInfo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bankName` to the `BusinessInfo` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CAC', 'BUSINESS_PERMIT', 'ID_PROOF');

-- AlterTable
ALTER TABLE "BusinessInfo" DROP COLUMN "logoUrl",
DROP COLUMN "openingHours",
DROP COLUMN "shortDesc",
DROP COLUMN "website",
ADD COLUMN     "accountName" TEXT NOT NULL,
ADD COLUMN     "accountNumber" TEXT NOT NULL,
ADD COLUMN     "bankName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "OAuthProvider" ADD COLUMN     "profileData" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profilePicture" TEXT;

-- AlterTable
ALTER TABLE "VendorDocument" DROP COLUMN "documentType",
ADD COLUMN     "documentType" "DocumentType" NOT NULL DEFAULT 'CAC';

-- DropEnum
DROP TYPE "public"."DocumentTpe";

-- CreateIndex
CREATE INDEX "OAuthProvider_provider_providerId_idx" ON "OAuthProvider"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthProvider_userId_provider_key" ON "OAuthProvider"("userId", "provider");
