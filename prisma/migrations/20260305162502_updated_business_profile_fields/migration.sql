-- AlterEnum
ALTER TYPE "StoreStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
