/*
  Warnings:

  - The values [MOTORCYCLE,TRUCK,VAN,BICYCLE,OTHER] on the enum `VehicleType` will be removed. If these variants are still used in the database, this will fail.
  - Changed the type of `dropoffLocation` on the `Order` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "VendorActionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ASSIGNED', 'REASSIGNING', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_STATUS', 'VENDOR_ACTION_REQUIRED', 'DRIVER_ASSIGNMENT', 'PICKUP_ALERT', 'RATING_REQUEST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'ORDER_PLACED';
ALTER TYPE "OrderStatus" ADD VALUE 'ORDER_ACCEPTED';
ALTER TYPE "OrderStatus" ADD VALUE 'ORDER_ASSIGNED';

-- AlterEnum
BEGIN;
CREATE TYPE "VehicleType_new" AS ENUM ('CAR', 'EV');
ALTER TABLE "public"."DriverProfile" ALTER COLUMN "vehicleType" DROP DEFAULT;
ALTER TABLE "DriverProfile" ALTER COLUMN "vehicleType" TYPE "VehicleType_new" USING ("vehicleType"::text::"VehicleType_new");
ALTER TYPE "VehicleType" RENAME TO "VehicleType_old";
ALTER TYPE "VehicleType_new" RENAME TO "VehicleType";
DROP TYPE "public"."VehicleType_old";
ALTER TABLE "DriverProfile" ALTER COLUMN "vehicleType" SET DEFAULT 'CAR';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."DriverDocument" DROP CONSTRAINT "DriverDocument_driverId_fkey";

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "deviceType" TEXT,
ADD COLUMN     "fcmToken" TEXT;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "dropoffLocation",
ADD COLUMN     "dropoffLocation" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deviceType" TEXT,
ADD COLUMN     "fcmToken" TEXT;

-- CreateTable
CREATE TABLE "OrderActivityLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus",
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorOrderAction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "VendorActionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "VendorOrderAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT,
    "assignmentStatus" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3),
    "etaSeconds" INTEGER,
    "pickupConfirmedAt" TIMESTAMP(3),
    "deliveryConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderActivityLog_orderId_idx" ON "OrderActivityLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderActivityLog_createdAt_idx" ON "OrderActivityLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOrderAction_orderId_key" ON "VendorOrderAction"("orderId");

-- CreateIndex
CREATE INDEX "VendorOrderAction_vendorId_idx" ON "VendorOrderAction"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverAssignment_orderId_key" ON "DriverAssignment"("orderId");

-- CreateIndex
CREATE INDEX "DriverAssignment_assignmentStatus_idx" ON "DriverAssignment"("assignmentStatus");

-- CreateIndex
CREATE INDEX "DriverAssignment_driverId_idx" ON "DriverAssignment"("driverId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderActivityLog" ADD CONSTRAINT "OrderActivityLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrderAction" ADD CONSTRAINT "VendorOrderAction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
