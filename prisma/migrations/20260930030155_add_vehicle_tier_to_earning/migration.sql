/*
  Warnings:

  - Added the required column `vehicleTier` to the `driver_earnings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
--ALTER TABLE "driver_earnings" ADD COLUMN     "vehicleTier" "VehicleType" NOT NULL;

ALTER TABLE "driver_earnings" ADD COLUMN "vehicleTier" "VehicleType";