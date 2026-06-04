-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'ORDER_DECLINED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "respondedAt" TIMESTAMP(3);
