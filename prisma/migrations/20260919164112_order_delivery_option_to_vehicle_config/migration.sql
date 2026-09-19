-- DropForeignKey
ALTER TABLE "public"."Order" DROP CONSTRAINT "Order_deliveryOptionId_fkey";

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryOptionId_fkey" FOREIGN KEY ("deliveryOptionId") REFERENCES "VehicleTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
