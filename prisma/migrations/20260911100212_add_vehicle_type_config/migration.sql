-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VehicleType" ADD VALUE 'E_BIKE';
ALTER TYPE "VehicleType" ADD VALUE 'MOTORCYCLE';

-- CreateTable
CREATE TABLE "VehicleTypeConfig" (
    "id" TEXT NOT NULL,
    "name" "VehicleType" NOT NULL DEFAULT 'CAR',
    "location" TEXT NOT NULL,
    "icon" TEXT,
    "deliveryRadiusKm" DOUBLE PRECISION NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minDeliveryFee" DECIMAL(10,2) NOT NULL,
    "perKmRate" DECIMAL(10,2) NOT NULL,
    "deliveryCommissionPct" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleTypeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistanceBand" (
    "id" TEXT NOT NULL,
    "vehicleTypeConfigId" TEXT NOT NULL,
    "fromKm" DOUBLE PRECISION NOT NULL,
    "toKm" DOUBLE PRECISION NOT NULL,
    "flatFee" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "DistanceBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleTypeConfig_location_idx" ON "VehicleTypeConfig"("location");

-- CreateIndex
CREATE INDEX "VehicleTypeConfig_isActive_idx" ON "VehicleTypeConfig"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTypeConfig_name_location_key" ON "VehicleTypeConfig"("name", "location");

-- CreateIndex
CREATE INDEX "DistanceBand_vehicleTypeConfigId_idx" ON "DistanceBand"("vehicleTypeConfigId");

-- AddForeignKey
ALTER TABLE "DistanceBand" ADD CONSTRAINT "DistanceBand_vehicleTypeConfigId_fkey" FOREIGN KEY ("vehicleTypeConfigId") REFERENCES "VehicleTypeConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
