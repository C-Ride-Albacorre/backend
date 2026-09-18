-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settlementId" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "vendor_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
