-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerPreparingNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "customerReadyNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "preparationDueAt" TIMESTAMP(3),
ADD COLUMN     "preparationReadyAt" TIMESTAMP(3),
ADD COLUMN     "preparationStartedAt" TIMESTAMP(3),
ADD COLUMN     "preparationTimeoutAt" TIMESTAMP(3);
