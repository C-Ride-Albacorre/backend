/*
  Warnings:

  - A unique constraint covering the columns `[payoutNumber]` on the table `driver_payouts` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `commissionAmount` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `commissionPct` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossEarnings` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `netPayout` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payoutNumber` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodEnd` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodStart` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tipTotal` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tripCount` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vehicleTier` to the `driver_payouts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "driver_earnings" ADD COLUMN     "payoutId" TEXT;

-- AlterTable
ALTER TABLE "driver_payouts" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "commissionAmount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "commissionPct" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "grossEarnings" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "netPayout" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payoutNumber" TEXT NOT NULL,
ADD COLUMN     "periodEnd" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "tipTotal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "tripCount" INTEGER NOT NULL,
ADD COLUMN     "vehicleTier" "VehicleType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "driver_payouts_payoutNumber_key" ON "driver_payouts"("payoutNumber");

-- CreateIndex
CREATE INDEX "driver_payouts_periodStart_periodEnd_idx" ON "driver_payouts"("periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "driver_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
