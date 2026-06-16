/*
  Warnings:

  - The `assignmentStatus` column on the `DriverAssignment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "VehicleType_new" AS ENUM ('CAR', 'EV');

-- DropForeignKey
ALTER TABLE "public"."DriverAssignment" DROP CONSTRAINT "DriverAssignment_driverId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DriverAssignment" DROP CONSTRAINT "DriverAssignment_orderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DriverDocument" DROP CONSTRAINT "DriverDocument_driverId_fkey";

-- DropIndex
DROP INDEX "public"."DriverAssignment_assignmentStatus_idx";

-- AlterTable
ALTER TABLE "DriverAssignment" DROP COLUMN "assignmentStatus",
ADD COLUMN     "assignmentStatus" TEXT DEFAULT 'PENDING',
ALTER COLUMN "assignedAt" SET DATA TYPE TIMESTAMP(6),
ALTER COLUMN "pickupConfirmedAt" SET DATA TYPE TIMESTAMP(6),
ALTER COLUMN "deliveryConfirmedAt" SET DATA TYPE TIMESTAMP(6);

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "dropoffLocation" SET DATA TYPE JSON;

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
