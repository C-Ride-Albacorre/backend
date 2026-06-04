-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "driverAssignedAt" TIMESTAMP(3),
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "vendorAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "vendorDeclinedAt" TIMESTAMP(3);
