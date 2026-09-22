-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDistanceKm" DECIMAL(10,3),
ADD COLUMN     "deliveryDistanceSource" TEXT;
