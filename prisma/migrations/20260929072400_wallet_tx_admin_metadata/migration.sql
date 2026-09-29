-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "initiatedById" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "relatedOrderId" TEXT;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
