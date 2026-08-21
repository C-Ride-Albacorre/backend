-- DropForeignKey
ALTER TABLE "public"."DriverDocument" DROP CONSTRAINT "DriverDocument_driverId_fkey";

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
