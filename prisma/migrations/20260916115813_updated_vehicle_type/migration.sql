-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('STANDARD', 'EXPRESS', 'PRIORITY', 'SCHEDULED');

-- AlterTable
ALTER TABLE "VehicleTypeConfig" ADD COLUMN     "deliveryType" "DeliveryType" NOT NULL DEFAULT 'STANDARD';
