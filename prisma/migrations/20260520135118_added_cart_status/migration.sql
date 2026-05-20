-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'ABANDONED');

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "abandonedAt" TIMESTAMP(3),
ADD COLUMN     "checkedOutAt" TIMESTAMP(3),
ADD COLUMN     "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE';
