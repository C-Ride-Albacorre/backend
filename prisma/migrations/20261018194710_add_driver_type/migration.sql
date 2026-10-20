-- CreateEnum
CREATE TYPE "DriverType" AS ENUM ('CRIDE', 'PARTNER');

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "driverType" "DriverType" NOT NULL DEFAULT 'CRIDE';
