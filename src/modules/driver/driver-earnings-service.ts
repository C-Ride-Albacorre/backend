import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../shared/services/prisma.service';
import { DriverOnlineHoursService } from './driver-online-hours-service';
import { WalletService } from '../wallet/wallet.service';
import Helper from '../../shared/utils/helpers';
import { PayoutStatus } from '@prisma/client';


type EarningsPeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

@Injectable()
export class DriverEarningsService {
  private readonly logger = new Logger(DriverEarningsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly onlineHours: DriverOnlineHoursService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Dashboard — cards + breakdown for the UI
  // ─────────────────────────────────────────────────────────────
  async getDashboard(driverId: string, period: EarningsPeriod, from?: Date, to?: Date) {
    const { start, end } = this.resolveRange(period, from, to);

    const [wallet, agg, breakdown, activeSeconds] = await Promise.all([
      this.getWalletSnapshot(driverId),
      this.aggregate(driverId, start, end),
      this.getDailyBreakdown(driverId, start, end),
      this.onlineHours.getActiveSecondsForRange(driverId, start, end),
    ]);

    const onlineHours = activeSeconds / 3600;
    const avgPerHour = onlineHours > 0 ? agg.totalEarnings / onlineHours : 0;

    return {
      period: { start, end, type: period },
      wallet,
      summary: {
        totalEarnings: Helper.round2(agg.totalEarnings),
        deliveries: agg.deliveries,
        tipsEarned: Helper.round2(agg.tips),
        bonuses: Helper.round2(agg.bonuses),
        onlineHours: Helper.round2(onlineHours),
        avgEarningsPerHour: Helper.round2(avgPerHour),
      },
      breakdown,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Wallet snapshot — reads available + pending
  // ─────────────────────────────────────────────────────────────
  private async getWalletSnapshot(driverId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: driverId },
      select: { balance: true, currency: true },
    });

    const pending = await this.prisma.walletTransaction.aggregate({
      where: {
        wallet: { userId: driverId },
        status: 'PENDING',
        type: 'CREDIT',
      },
      _sum: { amount: true },
    });

    return {
      availableBalance: Helper.round2(wallet?.balance ?? 0),
      pendingBalance: Helper.round2(pending._sum.amount ?? 0),
      currency: wallet?.currency ?? 'NGN',
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Aggregate earnings
  // ─────────────────────────────────────────────────────────────
  private async aggregate(driverId: string, start: Date, end: Date) {
    const rows = await this.prisma.driverEarning.findMany({
      where: {
        driverId,
        earnedAt: { gte: start, lte: end },
        status: { in: ['EARNED', 'CLEARED'] },
      },
      select: { totalAmount: true, tips: true, bonuses: true },
    });

    return {
      deliveries: rows.length,
      totalEarnings: rows.reduce((s, r) => s + r.totalAmount, 0),
      tips: rows.reduce((s, r) => s + r.tips, 0),
      bonuses: rows.reduce((s, r) => s + r.bonuses, 0),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Daily breakdown (DRV-023)
  // ─────────────────────────────────────────────────────────────
  private async getDailyBreakdown(driverId: string, start: Date, end: Date) {
    const earnings = await this.prisma.driverEarning.findMany({
      where: {
        driverId,
        earnedAt: { gte: start, lte: end },
        status: { in: ['EARNED', 'CLEARED'] },
      },
      select: { earnedAt: true, totalAmount: true },
    });

    // Pull daily stats — one row per day already (thanks to your existing service)
    const dayStats = await this.prisma.driverDailyStats.findMany({
      where: { driverId, date: { gte: start, lte: end } },
      select: { date: true, activeSeconds: true },
    });
    const secondsByDay = new Map(
      dayStats.map((d) => [d.date.toISOString().slice(0, 10), d.activeSeconds]),
    );

    // Seed every day in the range (so empty days render as zeros)
    const days: Array<{ date: string; deliveries: number; earnings: number; onlineHours: number }> = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      days.push({
        date: key,
        deliveries: 0,
        earnings: 0,
        onlineHours: Helper.round2((secondsByDay.get(key) ?? 0) / 3600),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const index = new Map(days.map((d) => [d.date, d]));

    for (const e of earnings) {
      const key = e.earnedAt.toISOString().slice(0, 10);
      const bucket = index.get(key);
      if (bucket) {
        bucket.deliveries += 1;
        bucket.earnings += e.totalAmount;
      }
    }

    return days.map((d) => ({ ...d, earnings: Helper.round2(d.earnings) }));
  }

  // ─────────────────────────────────────────────────────────────
  // Payout request — reuses existing debitWallet
  // ─────────────────────────────────────────────────────────────
  async requestPayout(driverId: string, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      // Lock wallet
      const [wallet] = await tx.$queryRaw<Array<{ id: string; balance: number }>>`
        SELECT id, balance FROM "Wallet" WHERE "userId" = ${driverId} FOR UPDATE
      `;
      if (!wallet) throw new BadRequestException('Wallet not found');

      const inFlight = await tx.driverPayout.findFirst({
        where: { driverId, status: { in: ['PENDING', 'PROCESSING'] } },
      });
      if (inFlight) throw new BadRequestException('You already have a payout in progress');

      if (amount < 1000) throw new BadRequestException('Minimum payout is ₦1,000');
      if (amount > wallet.balance) throw new BadRequestException('Insufficient available balance');

      const driver = await tx.user.findUnique({
        where: { id: driverId },
        select: {
          driverProfile: {
            select: { bankName: true, bankCode: true, accountNumber: true, accountName: true },
          },
        },
      });
      if (!driver?.driverProfile?.accountNumber) {
        throw new BadRequestException('Configure bank details on your profile first');
      }

      const payout = await tx.driverPayout.create({
        data: {
          reference: `PO-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          driverId,
          amount,
          bankSnapshot: driver.driverProfile as any,
          status: 'PENDING',
        },
      });

      // Reserve the amount immediately so it can't be double-spent
      await this.walletService.debitWallet(
        driverId,
        amount,
        `PAYOUT-RESERVE-${payout.id}`,
        `Payout request ${payout.reference}`,
      );

      return payout;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Admin: transition payout status
  // ─────────────────────────────────────────────────────────────
  async updatePayoutStatus(payoutId: string, status: PayoutStatus, adminId: string, failureReason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.driverPayout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new NotFoundException('Payout not found');

      const allowed: Record<PayoutStatus, PayoutStatus[]> = {
        PENDING:    ['PROCESSING', 'CANCELLED'],
        PROCESSING: ['PAID', 'FAILED'],
        PAID:       [],
        FAILED:     [],
        CANCELLED:  [],
      };
      if (!allowed[payout.status].includes(status)) {
        throw new BadRequestException(`Cannot move from ${payout.status} to ${status}`);
      }

      // Refund the reserved amount on failure/cancel
      if (status === 'FAILED' || status === 'CANCELLED') {
        await this.walletService.creditWallet(
          payout.driverId,
          payout.amount,
          `PAYOUT-REFUND-${payout.id}`,
          `Payout ${payout.reference} refunded`,
        );
      }

      return tx.driverPayout.update({
        where: { id: payoutId },
        data: {
          status,
          processedAt: new Date(),
          processedBy: adminId,
          failureReason: failureReason ?? null,
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Range resolution
  // ─────────────────────────────────────────────────────────────
  private resolveRange(period: EarningsPeriod, from?: Date, to?: Date) {
    const now = new Date();
    switch (period) {
      case 'TODAY': {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const end = new Date(start); end.setUTCHours(23, 59, 59, 999);
        return { start, end };
      }
      case 'WEEK': {
        const day = now.getUTCDay() || 7;
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
        const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6); end.setUTCHours(23, 59, 59, 999);
        return { start, end };
      }
      case 'MONTH': {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        return { start, end };
      }
      case 'CUSTOM': {
        if (!from || !to) throw new BadRequestException('from and to required for CUSTOM');
        if (from > to) throw new BadRequestException('from must be before to');
        if ((to.getTime() - from.getTime()) / 86400000 > 90) {
          throw new BadRequestException('Range cannot exceed 90 days');
        }
        return { start: from, end: to };
      }
    }
  }
}