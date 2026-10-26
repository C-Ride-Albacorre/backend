-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'UNACCEPTED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "assignedByAdminId" TEXT,
ADD COLUMN     "dispatchRadiusMeters" INTEGER,
ADD COLUMN     "distanceToCustomer" DOUBLE PRECISION,
ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "isVip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manuallyAssignedAt" TIMESTAMP(3),
ADD COLUMN     "preparationTime" INTEGER,
ADD COLUMN     "unacceptedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_orderStatus_createdAt_idx" ON "Order"("orderStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedByAdminId_fkey" FOREIGN KEY ("assignedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
