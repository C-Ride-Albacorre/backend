import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { DriverEarningsQueryDto, EarningsPeriod } from './dto/driver-earnings-query.dto';
import { DriverOnlineHoursService } from './driver-online-hours-service';
import Helper from '../../shared/utils/helpers';

// ─────────────────────────────────────────────────────────────────────
// Tunable business rules — never inline these. Ops and product should
// be able to change them without reading the query logic.
// ─────────────────────────────────────────────────────────────────────
const PERFORMANCE_RULES = {
  /** Grace period after the ETA before a delivery counts as late. */
  ON_TIME_BUFFER_MS: 5 * 60 * 1000,                 // +5 minutes

  /**
   * Whether expired offers (driver never responded in time) count
   * against the acceptance rate.
   *   false → exclude from denominator (default; expired ≠ declined)
   *   true  → include in denominator (expired counts as a miss)
   */
  COUNT_EXPIRED_AS_MISS: false,

  /** Minimum sample size before we show a rate. Below this → null. */
  MIN_SAMPLE_FOR_RATE: 1,

  /** A driver cannot realistically be online more than this many hours/day. */
  MAX_ONLINE_HOURS_PER_DAY: 24,

  /** Cap on the online hours contribution from a single (still-running) session. */
  MAX_LIVE_SESSION_SECONDS: 24 * 60 * 60,           // 24h

  /** Hard ceiling on a custom range; beyond this, use MONTH or multiple queries. */
  MAX_CUSTOM_RANGE_DAYS: 90,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Response shape (exported for controllers/tests)
// ─────────────────────────────────────────────────────────────────────
export interface DriverEarningsDashboard {
  period: { start: Date; end: Date; type: EarningsPeriod };
  wallet: {
    availableBalance: number;
    pendingBalance: number;
    /** Combined "on the card" number: available + pending + earnings in the period. */
    totalOnCard: number;
    currency: string;
  };
  summary: {
    /** Period-scoped earnings (this day / week / month). */
    earningsInPeriod: number;
    /**
     * Total Earnings card value = wallet.availableBalance + pendingBalance +
     * this period's earnings. Matches the UI's "Total Earnings" tile.
     */
    totalEarnings: number;
    deliveries: number;
    tipsEarned: number;
    bonuses: number;
    onlineHours: number;
    avgEarningsPerHour: number;
  };
  performance: {
    scope: 'lifetime';
    acceptanceRate: number | null;
    completionRate: number | null;
    onTimeRate: number | null;
    counts: {
      offered: number;
      accepted: number;
      declined: number;
      expired: number;
      completed: number;
      onTime: number;
    };
  };
  breakdown: Array<{
    date: string;
    deliveries: number;
    earnings: number;
    onlineHours: number;
  }>;
  /** For MONTH period only: week-on-week aggregation inside the month. */
  weeklyAggregation?: Array<{
    weekLabel: string;       // "Sep 01 – Sep 07"
    weekStart: string;       // ISO date
    weekEnd: string;         // ISO date
    deliveries: number;
    earnings: number;
    onlineHours: number;
  }>;
}

@Injectable()
export class DriverEarningsService {
  private readonly logger = new Logger(DriverEarningsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly onlineHours: DriverOnlineHoursService,
  ) {}

  // ═════════════════════════════════════════════════════════════════
  // PUBLIC — Dashboard
  // ═════════════════════════════════════════════════════════════════
  async getDashboardold(
    driverId: string,
    period: EarningsPeriod,
    from?: Date,
    to?: Date,
  ): Promise<DriverEarningsDashboard> {
    const { start, end } = this.resolveRange(period, from, to);

    // All four data sources in parallel. `performanceMetrics` is deliberately
    // named to avoid colliding with the Node.js global `performance`.
    const [wallet, agg, breakdown, activeSeconds, performanceMetrics] =
      await Promise.all([
        this.getWalletSnapshot(driverId),
        this.aggregate(driverId, start, end),
        this.getDailyBreakdown(driverId, start, end),
        this.onlineHours.getActiveSecondsForRange(driverId, start, end),
        this.getPerformanceMetrics(driverId),
      ]);

    // Clamp online hours so a stuck session can't inflate the metric.
    const cappedSeconds = Math.min(
      activeSeconds,
      PERFORMANCE_RULES.MAX_ONLINE_HOURS_PER_DAY *
        Math.max(1, this.daysBetween(start, end)) *
        3600,
    );
    const onlineHours = cappedSeconds / 3600;
    const avgPerHour = onlineHours > 0 ? agg.totalEarnings / onlineHours : 0;

    // The "Total Earnings" tile = wallet balance + pending + this period.
    // This matches the screenshot where Total Earnings sits next to the wallet.
    const totalEarningsOnCard =
      wallet.availableBalance + wallet.pendingBalance + agg.totalEarnings;

    // Week-on-week aggregation is only meaningful for MONTH.
    const weeklyAggregation =
      period === EarningsPeriod.MONTH
        ? this.buildWeeklyAggregation(breakdown, start, end)
        : undefined;

    return {
      period: { start, end, type: period },
      wallet: {
        availableBalance: wallet.availableBalance,
        pendingBalance: wallet.pendingBalance,
        totalOnCard: Helper.round2(totalEarningsOnCard),
        currency: wallet.currency,
      },
      summary: {
        earningsInPeriod: Helper.round2(agg.totalEarnings),
        totalEarnings: Helper.round2(totalEarningsOnCard),
        deliveries: agg.deliveries,
        tipsEarned: Helper.round2(agg.tips),
        bonuses: Helper.round2(agg.bonuses),
        onlineHours: Helper.round2(onlineHours),
        avgEarningsPerHour: Helper.round2(avgPerHour),
      },
      performance: performanceMetrics,
      breakdown,
      ...(weeklyAggregation ? { weeklyAggregation } : {}),
    };
  }

  async getDashboard(
  driverId: string,
  period: EarningsPeriod,
  from?: Date,
  to?: Date,
): Promise<DriverEarningsDashboard> {
  const { start, end } = this.resolveRange(period, from, to);

  const [wallet, agg, activeSeconds, performanceMetrics] = await Promise.all([
    this.getWalletSnapshot(driverId),
    this.aggregate(driverId, start, end),
    this.onlineHours.getActiveSecondsForRange(driverId, start, end),
    this.getPerformanceMetrics(driverId),
  ]);

  // Clamp online seconds so a stuck session can't inflate the metric.
  const cappedSeconds = Math.min(
    activeSeconds,
    PERFORMANCE_RULES.MAX_ONLINE_HOURS_PER_DAY *
      Math.max(1, this.daysBetween(start, end)) *
      3600,
  );
  const onlineHours = cappedSeconds / 3600;
  const avgPerHour = onlineHours > 0 ? agg.totalEarnings / onlineHours : 0;

  // Total Earnings card = wallet + pending + this period's earnings.
  const totalEarningsOnCard =
    wallet.availableBalance + wallet.pendingBalance + agg.totalEarnings;

  // ── Breakdown strategy per period ─────────────────────────────
  //  TODAY  → one row per delivery (per earning), online hours split evenly
  //  WEEK   → one row per day (existing behaviour)
  //  MONTH  → NO daily breakdown; weeklyAggregation only
  //  CUSTOM → one row per day (same as WEEK)
  let breakdown: DriverEarningsDashboard['breakdown'] = [];
  let weeklyAggregation: DriverEarningsDashboard['weeklyAggregation'];

  if (period === EarningsPeriod.TODAY) {
    breakdown = await this.getPerDeliveryBreakdown(
      driverId,
      start,
      end,
      cappedSeconds,
    );
  } else if (period === EarningsPeriod.MONTH) {
    const dailyBreakdown = await this.getDailyBreakdown(driverId, start, end);
    weeklyAggregation = this.buildWeeklyAggregation(
      dailyBreakdown,
      start,
      end,
    );
    breakdown = [];   // ← MONTH uses weeklyAggregation instead
  } else {
    breakdown = await this.getDailyBreakdown(driverId, start, end);
  }

  return {
    period: { start, end, type: period },
    wallet: {
      availableBalance: wallet.availableBalance,
      pendingBalance: wallet.pendingBalance,
      totalOnCard: Helper.round2(totalEarningsOnCard),
      currency: wallet.currency,
    },
    summary: {
      earningsInPeriod: Helper.round2(agg.totalEarnings),
      totalEarnings: Helper.round2(totalEarningsOnCard),
      deliveries: agg.deliveries,
      tipsEarned: Helper.round2(agg.tips),
      bonuses: Helper.round2(agg.bonuses),
      onlineHours: Helper.round2(onlineHours),
      avgEarningsPerHour: Helper.round2(avgPerHour),
    },
    performance: performanceMetrics,
    breakdown,
    ...(weeklyAggregation ? { weeklyAggregation } : {}),
  };
}

  // ═════════════════════════════════════════════════════════════════
  // PUBLIC — Performance metrics (also exposed as a standalone endpoint)
  // ═════════════════════════════════════════════════════════════════
  /**
   * Lifetime performance metrics for a driver.
   *
   * Deliberately NOT filtered by the dashboard's date range — these are
   * cumulative "career" metrics, exactly like a credit score.
   *
   * Returns rates as percentages (0–100) or null when there isn't enough
   * data to compute a meaningful rate.
   */
  async getPerformanceMetrics(driverId: string) {
    const assignments = await this.prisma.driverAssignment.findMany({
      where: { driverId },
      select: {
        assignmentStatus: true,
        assignedAt: true,
        etaSeconds: true,
        deliveryConfirmedAt: true,
      },
    });

    let offered = 0;
    let accepted = 0;
    let declined = 0;
    let expired = 0;
    let completed = 0;
    let onTime = 0;
    let completedWithEta = 0;

    for (const a of assignments) {
      offered += 1;

      // "Accepted" = assignedAt is set. Status alone isn't reliable because
      // we flip EXPIRED after a delivery completes.
      const wasAccepted = a.assignedAt !== null;

      if (wasAccepted) {
        accepted += 1;
      } else if (a.assignmentStatus === 'DECLINED') {
        declined += 1;
      } else if (a.assignmentStatus === 'EXPIRED') {
        expired += 1;
      }

      const wasCompleted = a.deliveryConfirmedAt !== null;
      if (wasCompleted) {
        completed += 1;

        if (a.assignedAt && a.etaSeconds !== null) {
          completedWithEta += 1;

          const expectedAt =
            a.assignedAt.getTime() +
            a.etaSeconds * 1000 +
            PERFORMANCE_RULES.ON_TIME_BUFFER_MS;
          const deliveredAt = a.deliveryConfirmedAt!.getTime();

          if (deliveredAt <= expectedAt) onTime += 1;
        }
      }
    }

    const acceptanceDenominator = PERFORMANCE_RULES.COUNT_EXPIRED_AS_MISS
      ? accepted + declined + expired
      : accepted + declined;

    const acceptanceRate =
      acceptanceDenominator >= PERFORMANCE_RULES.MIN_SAMPLE_FOR_RATE
        ? Helper.round2((accepted / acceptanceDenominator) * 100)
        : null;

    const completionRate =
      accepted >= PERFORMANCE_RULES.MIN_SAMPLE_FOR_RATE
        ? Helper.round2((completed / accepted) * 100)
        : null;

    const onTimeRate =
      completedWithEta >= PERFORMANCE_RULES.MIN_SAMPLE_FOR_RATE
        ? Helper.round2((onTime / completedWithEta) * 100)
        : null;

    return {
      scope: 'lifetime' as const,
      acceptanceRate,
      completionRate,
      onTimeRate,
      counts: { offered, accepted, declined, expired, completed, onTime },
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // PUBLIC — Payout flows
  // ═════════════════════════════════════════════════════════════════
  async requestPayout(driverId: string, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      const [wallet] = await tx.$queryRaw<
        Array<{ id: string; balance: number }>
      >`
        SELECT id, balance FROM "Wallet"
        WHERE "userId" = ${driverId}
        FOR UPDATE
      `;
      if (!wallet) throw new BadRequestException('Wallet not found');

      const inFlight = await tx.driverPayout.findFirst({
        where: { driverId, status: { in: ['PENDING', 'PROCESSING'] } },
      });
      if (inFlight) {
        throw new BadRequestException('You already have a payout in progress');
      }

      if (amount < 1000) {
        throw new BadRequestException('Minimum payout is ₦1,000');
      }
      if (amount > wallet.balance) {
        throw new BadRequestException('Insufficient available balance');
      }

      const driver = await tx.user.findUnique({
        where: { id: driverId },
        select: {
          driverProfile: {
            select: {
              bankName: true,
              bankCode: true,
              accountNumber: true,
              accountName: true,
            },
          },
        },
      });
      if (!driver?.driverProfile?.accountNumber) {
        throw new BadRequestException(
          'Configure bank details on your profile first',
        );
      }

      const payout = await tx.driverPayout.create({
        data: {
          reference: `PO-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)
            .toUpperCase()}`,
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

      this.logger.log(
        `Payout requested: driver=${driverId} amount=${amount} ref=${payout.reference}`,
      );
      return payout;
    });
  }

  async updatePayoutStatus(
    payoutId: string,
    status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED',
    adminId: string,
    failureReason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.driverPayout.findUnique({
        where: { id: payoutId },
      });
      if (!payout) throw new NotFoundException('Payout not found');

      const allowed: Record<typeof payout.status, typeof payout.status[]> = {
        PENDING: ['PROCESSING', 'CANCELLED'],
        PROCESSING: ['PAID', 'FAILED'],
        PAID: [],
        FAILED: [],
        CANCELLED: [],
      };
      if (!allowed[payout.status].includes(status)) {
        throw new BadRequestException(
          `Cannot move from ${payout.status} to ${status}`,
        );
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

      const updated = await tx.driverPayout.update({
        where: { id: payoutId },
        data: {
          status,
          processedAt: new Date(),
          processedBy: adminId,
          failureReason: failureReason ?? null,
        },
      });

      this.logger.log(
        `Payout ${payout.reference} → ${status} by admin ${adminId}`,
      );
      return updated;
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // INTERNAL — Wallet snapshot
  // ═════════════════════════════════════════════════════════════════
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

  // ═════════════════════════════════════════════════════════════════
  // INTERNAL — Earnings aggregation
  // ═════════════════════════════════════════════════════════════════
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

  // ═════════════════════════════════════════════════════════════════
  // INTERNAL — Daily breakdown
  // ═════════════════════════════════════════════════════════════════
  /**
   * Per-day breakdown for the requested range.
   *   - TODAY   → one entry for today
   *   - WEEK    → 7 entries (Mon … Sun)
   *   - MONTH   → one entry per day of the month
   *   - CUSTOM  → one entry per day in [from, to]
   *
   * Online hours come from DriverDailyStats (persisted). A live session's
   * running duration is added ONLY to today's bucket — never smeared across
   * every day in range.
   */
  private async getDailyBreakdown(driverId: string, start: Date, end: Date) {
    const earnings = await this.prisma.driverEarning.findMany({
      where: {
        driverId,
        earnedAt: { gte: start, lte: end },
        status: { in: ['EARNED', 'CLEARED'] },
      },
      select: { earnedAt: true, totalAmount: true },
    });

    const dayStats = await this.prisma.driverDailyStats.findMany({
      where: { driverId, date: { gte: start, lte: end } },
      select: { date: true, activeSeconds: true },
    });

    const secondsByDay = new Map(
      dayStats.map((d) => [d.date.toISOString().slice(0, 10), d.activeSeconds]),
    );

    // Seed every day in range so the client renders zeros, not gaps
    const days: DriverEarningsDashboard['breakdown'] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const seconds = secondsByDay.get(key) ?? 0;
      const cappedSeconds = Math.min(
        seconds,
        PERFORMANCE_RULES.MAX_ONLINE_HOURS_PER_DAY * 3600,
      );
      days.push({
        date: key,
        deliveries: 0,
        earnings: 0,
        onlineHours: Helper.round2(cappedSeconds / 3600),
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

    // Add the live session to TODAY only — and clamp to the day cap.
    const todayKey = new Date().toISOString().slice(0, 10);
    if (index.has(todayKey)) {
      const liveSeconds = await this.onlineHours.getCurrentActiveDuration(
        driverId,
      );
      if (liveSeconds && liveSeconds > 0) {
        const capped = Math.min(
          liveSeconds,
          PERFORMANCE_RULES.MAX_LIVE_SESSION_SECONDS,
        );
        const todayBucket = index.get(todayKey)!;
        // today's persisted seconds + live seconds, capped at 24h
        const persistedSeconds = secondsByDay.get(todayKey) ?? 0;
        const combined = Math.min(
          persistedSeconds + capped,
          PERFORMANCE_RULES.MAX_ONLINE_HOURS_PER_DAY * 3600,
        );
        todayBucket.onlineHours = Helper.round2(combined / 3600);
      }
    }

    return days.map((d) => ({ ...d, earnings: Helper.round2(d.earnings) }));
  }

  // ═════════════════════════════════════════════════════════════════
  // INTERNAL — Week-on-week aggregation (MONTH period only)
  // ═════════════════════════════════════════════════════════════════
  /**
   * Splits the daily breakdown into Monday-starting weeks within the month
   * and sums deliveries, earnings, and online hours for each week.
   *
   * Only returned for period=MONTH so the client can render a "week on week"
   * view without recomputing anything.
   */
  private buildWeeklyAggregation(
    breakdown: DriverEarningsDashboard['breakdown'],
    rangeStart: Date,
    rangeEnd: Date,
  ): DriverEarningsDashboard['weeklyAggregation'] {
    const weeks: NonNullable<
      DriverEarningsDashboard['weeklyAggregation']
    > = [];

    let cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      // Find Monday of this ISO week
      const dow = cursor.getUTCDay() || 7;   // Sunday → 7
      const monday = new Date(cursor);
      monday.setUTCDate(monday.getUTCDate() - (dow - 1));
      monday.setUTCHours(0, 0, 0, 0);

      // Sunday end
      const sunday = new Date(monday);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      // Clamp to the requested month range
      const weekStart = monday < rangeStart ? rangeStart : monday;
      const weekEnd = sunday > rangeEnd ? rangeEnd : sunday;

      const startKey = weekStart.toISOString().slice(0, 10);
      const endKey = weekEnd.toISOString().slice(0, 10);

      const inWeek = breakdown.filter(
        (d) => d.date >= startKey && d.date <= endKey,
      );

      weeks.push({
        weekLabel: `${this.formatDateShort(weekStart)} – ${this.formatDateShort(
          weekEnd,
        )}`,
        weekStart: startKey,
        weekEnd: endKey,
        deliveries: inWeek.reduce((s, d) => s + d.deliveries, 0),
        earnings: Helper.round2(
          inWeek.reduce((s, d) => s + d.earnings, 0),
        ),
        onlineHours: Helper.round2(
          inWeek.reduce((s, d) => s + d.onlineHours, 0),
        ),
      });

      // Advance to the Monday after this week
      cursor = new Date(sunday);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return weeks;
  }


  /**
 * Per-delivery breakdown for a range. Currently only used for TODAY,
 * where "deliveries for the day" is the meaningful unit.
 *
 * Online hours are split evenly across the deliveries in the range.
 * Why even split: the alternative (session-based attribution) requires
 * joining DriverSession ranges against earning timestamps and defining
 * what happens when a delivery has no session — which is noisy. The
 * even split is honest ("you were online X hours and did Y deliveries,
 * averaging Z hours per delivery") and doesn't lie about precision.
 *
 * If you want session-based attribution later, swap the onlineHours
 * calculation for a per-earning lookup against DriverSession.
 */
private async getPerDeliveryBreakdown(
  driverId: string,
  start: Date,
  end: Date,
  totalOnlineSeconds: number,
): Promise<DriverEarningsDashboard['breakdown']> {
  const earnings = await this.prisma.driverEarning.findMany({
    where: {
      driverId,
      earnedAt: { gte: start, lte: end },
      status: { in: ['EARNED', 'CLEARED'] },
    },
    select: {
      id: true,
      orderId: true,
      totalAmount: true,
      earnedAt: true,
    },
    orderBy: { earnedAt: 'asc' },
  });

  if (earnings.length === 0) {
    // Return one zero row so the client renders an empty card, not a crash
    return [
      {
        date: start.toISOString().slice(0, 10),
        deliveries: 0,
        earnings: 0,
        onlineHours: 0,
      },
    ];
  }

  // Even split of the period's online seconds across all deliveries.
  const perDeliverySeconds =
    totalOnlineSeconds > 0 ? totalOnlineSeconds / earnings.length : 0;
  const perDeliveryHours = Helper.round2(perDeliverySeconds / 3600);

  return earnings.map((e) => ({
    // The date the delivery was completed
    date: e.earnedAt.toISOString().slice(0, 10),
    // One delivery per row — this is the whole point of TODAY
    deliveries: 1,
    earnings: Helper.round2(e.totalAmount),
    // Each delivery gets an equal slice of the day's online hours
    onlineHours: perDeliveryHours,
  }));
}

  // ═════════════════════════════════════════════════════════════════
  // INTERNAL — Range resolution
  // ═════════════════════════════════════════════════════════════════
  /**
   * Resolution order:
   *   1. If from AND to are both present → use them (auto-upgrades period).
   *   2. Otherwise compute the range for the named period.
   *
   * This means a client sending `period=WEEK&from=...&to=...` gets the
   * explicit dates, not the calendar week. That's the friendlier behaviour.
   */
  private resolveRange(period: EarningsPeriod, from?: Date, to?: Date) {
    // Explicit dates win
    if (from && to) {
      if (from > to) {
        throw new BadRequestException('from must be before to');
      }
      const days = this.daysBetween(from, to);
      if (days > PERFORMANCE_RULES.MAX_CUSTOM_RANGE_DAYS) {
        throw new BadRequestException(
          `Range cannot exceed ${PERFORMANCE_RULES.MAX_CUSTOM_RANGE_DAYS} days`,
        );
      }
      return { start: from, end: to };
    }

    const now = new Date();

    switch (period) {
      case EarningsPeriod.TODAY: {
        const start = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
          ),
        );
        const end = new Date(start);
        end.setUTCHours(23, 59, 59, 999);
        return { start, end };
      }

      case EarningsPeriod.WEEK: {
        // Monday → Sunday of the current ISO week
        const dow = now.getUTCDay() || 7;
        const start = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - (dow - 1),
          ),
        );
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);
        end.setUTCHours(23, 59, 59, 999);
        return { start, end };
      }

      case EarningsPeriod.MONTH: {
        const start = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
        const end = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            0, // last day of month
            23,
            59,
            59,
            999,
          ),
        );
        return { start, end };
      }

      case EarningsPeriod.CUSTOM: {
        throw new BadRequestException(
          'from and to are required for CUSTOM period',
        );
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // INTERNAL — Small utilities
  // ═════════════════════════════════════════════════════════════════
  private daysBetween(a: Date, b: Date): number {
    return Math.ceil(
      (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  private formatDateShort(d: Date): string {
    return d
      .toLocaleString('en-NG', {
        month: 'short',
        day: '2-digit',
        timeZone: 'UTC',
      })
      .replace(',', '');
  }
}