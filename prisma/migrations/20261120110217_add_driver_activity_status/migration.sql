-- CreateEnum
CREATE TYPE "DriverActivityStatus" AS ENUM ('AVAILABLE', 'NOT_AVAILABLE', 'WAY_TO_PICKUP', 'ARRIVED', 'WAY_TO_DELIVER');

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "activityStatus" "DriverActivityStatus" NOT NULL DEFAULT 'NOT_AVAILABLE';

-- CreateIndex
CREATE INDEX "DriverProfile_activityStatus_idx" ON "DriverProfile"("activityStatus");
