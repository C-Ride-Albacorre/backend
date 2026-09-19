-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('EARNED', 'CLEARED', 'HOLD', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "walletTxId" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "commissionPct" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "tips" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonuses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'EARNED',
    "reversalReason" TEXT,
    "clearedAt" TIMESTAMP(3),
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payouts" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "bankSnapshot" JSONB NOT NULL,
    "walletTxId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_earnings_orderId_key" ON "driver_earnings"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_earnings_walletTxId_key" ON "driver_earnings"("walletTxId");

-- CreateIndex
CREATE INDEX "driver_earnings_driverId_earnedAt_idx" ON "driver_earnings"("driverId", "earnedAt");

-- CreateIndex
CREATE INDEX "driver_earnings_driverId_status_idx" ON "driver_earnings"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "driver_payouts_reference_key" ON "driver_payouts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "driver_payouts_walletTxId_key" ON "driver_payouts"("walletTxId");

-- CreateIndex
CREATE INDEX "driver_payouts_driverId_status_idx" ON "driver_payouts"("driverId", "status");

-- CreateIndex
CREATE INDEX "driver_payouts_status_requestedAt_idx" ON "driver_payouts"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
