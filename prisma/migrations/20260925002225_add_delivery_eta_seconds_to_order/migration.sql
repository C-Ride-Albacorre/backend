/*
  Warnings:

  - You are about to drop the `ServiceFee` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TaxSetting` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryEtaSeconds" INTEGER;

-- DropTable
DROP TABLE "public"."ServiceFee";

-- DropTable
DROP TABLE "public"."TaxSetting";

-- DropEnum
DROP TYPE "public"."FeeApplicableTo";

-- DropEnum
DROP TYPE "public"."FeeType";

-- DropEnum
DROP TYPE "public"."TaxApplicableTo";
