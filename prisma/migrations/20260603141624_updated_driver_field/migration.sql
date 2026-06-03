/*
  Warnings:

  - You are about to drop the column `deviceType` on the `DriverProfile` table. All the data in the column will be lost.
  - You are about to drop the column `fcmToken` on the `DriverProfile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DriverProfile" DROP COLUMN "deviceType",
DROP COLUMN "fcmToken";
