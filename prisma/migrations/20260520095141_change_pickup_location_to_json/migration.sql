/*
  Warnings:

  - The `pickupLocation` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DriverStatus" ADD VALUE 'REJECTED';
ALTER TYPE "DriverStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "pickupLocation",
ADD COLUMN     "pickupLocation" JSONB;
