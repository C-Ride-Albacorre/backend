/*
  Warnings:

  - A unique constraint covering the columns `[vendorCode]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pickupVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "vendorCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_vendorCode_key" ON "Order"("vendorCode");

-- CreateIndex
CREATE INDEX "Order_vendorCode_idx" ON "Order"("vendorCode");
