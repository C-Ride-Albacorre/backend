-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "vehicleTypeConfigId" TEXT;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_vehicleTypeConfigId_fkey" FOREIGN KEY ("vehicleTypeConfigId") REFERENCES "VehicleTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
