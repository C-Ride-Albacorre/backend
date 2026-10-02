import {
    Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { PayoutStatus, Prisma, VehicleType } from '@prisma/client';
import {
    GeneratePayoutsDto, ListPayoutsDto, UpdatePayoutStatusDto,
} from './dto/payout/driver-payout.dto';
import { randomUUID } from 'crypto';
import { MonnifyService } from '../payment/monnify.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DriverPayoutService {
    private readonly logger = new Logger(DriverPayoutService.name);

    constructor(private readonly prisma: PrismaService,
        private readonly monnifyService: MonnifyService,
        private configService: ConfigService,

    ) { }

    // ------------------------------------------------------------------
    // 1. Dashboard summary
    // ------------------------------------------------------------------
    //   async getSummary() {
    //     const [totals, pending, processing, activeDrivers, commissionAgg] =
    //       await this.prisma.$transaction([
    //         this.prisma.driverPayout.aggregate({
    //           where: { status: PayoutStatus.PAID },
    //           _sum: { netPayout: true },
    //           _count: { id: true },
    //         }),
    //         this.prisma.driverPayout.aggregate({
    //           where: { status: PayoutStatus.PENDING },
    //           _sum: { netPayout: true },
    //           _count: { id: true },
    //         }),
    //         this.prisma.driverPayout.aggregate({
    //           where: { status: PayoutStatus.PROCESSING },
    //           _sum: { netPayout: true },
    //           _count: { id: true },
    //         }),
    //         this.prisma.driverPayout.groupBy({
    //           by: ['driverId'],
    //           where: {
    //             status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
    //           },
    //         }),
    //         this.prisma.driverPayout.aggregate({
    //           _sum: { commissionAmount: true },
    //           where: { status: PayoutStatus.PAID },
    //         }),
    //       ]);

    //     return {
    //       totalDisbursed: Number(totals._sum.netPayout ?? 0),
    //       totalDisbursedCount: totals._count.id,
    //       processingAmount: Number(processing._sum.netPayout ?? 0),
    //       processingDrivers: processing._count.id,
    //       pendingAmount: Number(pending._sum.netPayout ?? 0),
    //       pendingDrivers: pending._count.id,
    //       activeDrivers: activeDrivers.length,
    //       totalCommissionEarned: Number(commissionAgg._sum.commissionAmount ?? 0),
    //     };
    //   }
    async getSummary() {
        const [totals, pending, processing, activeDrivers, commissionAgg] =
            await this.prisma.$transaction([
                this.prisma.driverPayout.aggregate({
                    where: { status: PayoutStatus.PAID },
                    _sum: { netPayout: true },
                    _count: { id: true },
                }),
                this.prisma.driverPayout.aggregate({
                    where: { status: PayoutStatus.PENDING },
                    _sum: { netPayout: true },
                    _count: { id: true },
                }),
                this.prisma.driverPayout.aggregate({
                    where: { status: PayoutStatus.PROCESSING },
                    _sum: { netPayout: true },
                    _count: { id: true },
                }),

                // ✅ REPLACED groupBy with a simple distinct query
                this.prisma.driverPayout.findMany({
                    where: {
                        status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
                    },
                    select: { driverId: true },
                    distinct: ['driverId'],
                }),

                this.prisma.driverPayout.aggregate({
                    _sum: { commissionAmount: true },
                    where: { status: PayoutStatus.PAID },
                }),
            ]);

        return {
            totalDisbursed: Number(totals._sum.netPayout ?? 0),
            totalDisbursedCount: totals._count.id,
            processingAmount: Number(processing._sum.netPayout ?? 0),
            processingDrivers: processing._count.id,
            pendingAmount: Number(pending._sum.netPayout ?? 0),
            pendingDrivers: pending._count.id,
            activeDrivers: activeDrivers.length,
            totalCommissionEarned: Number(commissionAgg._sum.commissionAmount ?? 0),
        };
    }
    // ------------------------------------------------------------------
    // 2. List payouts with filters + pagination
    // ------------------------------------------------------------------
    async list(dto: ListPayoutsDto) {
        const { status, search, tier, from, to, page = 1, limit = 20 } = dto;
        const skip = (page - 1) * limit;

        const where: Prisma.DriverPayoutWhereInput = {};
        if (status) where.status = status;
        if (tier) where.vehicleTier = tier;
        if (from || to) {
            where.periodStart = {};
            if (from) where.periodStart.gte = new Date(from);
            if (to) where.periodEnd = { lte: new Date(to) };
        }
        if (search) {
            where.OR = [
                { payoutNumber: { contains: search, mode: 'insensitive' } },
                { driver: { firstName: { contains: search, mode: 'insensitive' } } },
                { driver: { lastName: { contains: search, mode: 'insensitive' } } },
                { driver: { email: { contains: search, mode: 'insensitive' } } },
            ];
        }

        // ✅ Run these as separate queries instead of a single transaction with groupBy
        const [rows, total] = await Promise.all([
            this.prisma.driverPayout.findMany({
                where,
                include: {
                    driver: {
                        select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.driverPayout.count({ where }),
        ]);

        // Status counts (safely, without groupBy type issues)
        const [pendingCount, processingCount, paidCount] = await Promise.all([
            this.prisma.driverPayout.count({ where: { ...where, status: PayoutStatus.PENDING } }),
            this.prisma.driverPayout.count({ where: { ...where, status: PayoutStatus.PROCESSING } }),
            this.prisma.driverPayout.count({ where: { ...where, status: PayoutStatus.PAID } }),
        ]);

        return {
            data: rows.map((r) => this.mapPayout(r)),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                counts: {
                    all: total,
                    pending: pendingCount,
                    processing: processingCount,
                    paid: paidCount,
                },
            },
        };
    }
    //   async list(dto: ListPayoutsDto) {
    //     const { status, search, tier, from, to, page = 1, limit = 20 } = dto;
    //     const skip = (page - 1) * limit;

    //     const where: Prisma.DriverPayoutWhereInput = {};
    //     if (status) where.status = status;
    //     if (tier) where.vehicleTier = tier;
    //     if (from || to) {
    //       where.periodStart = {};
    //       if (from) where.periodStart.gte = new Date(from);
    //       if (to) where.periodEnd = { lte: new Date(to) };
    //     }
    //     if (search) {
    //       where.OR = [
    //         { payoutNumber: { contains: search, mode: 'insensitive' } },
    //         { driver: { firstName: { contains: search, mode: 'insensitive' } } },
    //         { driver: { lastName: { contains: search, mode: 'insensitive' } } },
    //         { driver: { email: { contains: search, mode: 'insensitive' } } },
    //       ];
    //     }

    //     const [rows, total, counts] = await this.prisma.$transaction([
    //       this.prisma.driverPayout.findMany({
    //         where,
    //         include: {
    //           driver: {
    //             select: {
    //               id: true, firstName: true, lastName: true, email: true, phoneNumber: true,
    //             },
    //           },
    //         },
    //         orderBy: { createdAt: 'desc' },
    //         skip,
    //         take: limit,
    //       }),
    //       this.prisma.driverPayout.count({ where }),
    //       this.prisma.driverPayout.groupBy({
    //         by: ['status'],
    //         _count: { id: true },
    //       }),
    //     ]);

    //     const statusCounts = counts.reduce((acc, c) => {
    //       acc[c.status] = c._count.id;
    //       return acc;
    //     }, {} as Record<string, number>);

    //     return {
    //       data: rows.map((r) => this.mapPayout(r)),
    //       meta: {
    //         total,
    //         page,
    //         limit,
    //         totalPages: Math.ceil(total / limit),
    //         counts: {
    //           all: total,
    //           pending: statusCounts[PayoutStatus.PENDING] ?? 0,
    //           processing: statusCounts[PayoutStatus.PROCESSING] ?? 0,
    //           paid: statusCounts[PayoutStatus.PAID] ?? 0,
    //         },
    //       },
    //     };
    //   }

    private mapPayout(p: any) {
        return {
            id: p.id,
            payoutNumber: p.payoutNumber,
            driver: {
                id: p.driver.id,
                name: `${p.driver.firstName ?? ''} ${p.driver.lastName ?? ''}`.trim() || p.driver.email,
                email: p.driver.email,
                phone: p.driver.phoneNumber,
            },
            tier: p.vehicleTier,
            trips: p.tripCount,
            grossEarnings: Number(p.grossEarnings),
            commissionPct: Number(p.commissionPct),
            commissionAmount: Number(p.commissionAmount),
            tipTotal: Number(p.tipTotal),
            netPayout: Number(p.netPayout),
            status: p.status,
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            paidAt: p.paidAt,
            reference: p.reference,
            note: p.note,
            createdAt: p.createdAt,
        };
    }

    // ------------------------------------------------------------------
    // 3. Generate payouts for a period
    //    Uses VehicleTypeConfig.deliveryCommissionPct as commission source
    // ------------------------------------------------------------------
    async generate(dto: GeneratePayoutsDto, adminId: string) {
        const start = new Date(dto.periodStart);
        const end = new Date(dto.periodEnd);
        if (end <= start) {
            throw new BadRequestException('periodEnd must be after periodStart');
        }

        const earnings = await this.prisma.driverEarning.findMany({
            where: {
                payoutId: null,
                earnedAt: { gte: start, lte: end },
                ...(dto.driverId ? { driverId: dto.driverId } : {}),
            },
            include: {
                driver: { select: { id: true, firstName: true, lastName: true, email: true } },
                order: { select: { id: true, orderNumber: true } },
            },
        });

        if (earnings.length === 0) {
            throw new BadRequestException('No unbundled earnings found for this period');
        }

        const byDriver = new Map<string, typeof earnings>();
        for (const e of earnings) {
            const arr = byDriver.get(e.driverId) ?? [];
            arr.push(e);
            byDriver.set(e.driverId, arr);
        }

        const created: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const [driverId, list] of byDriver.entries()) {
                const existing = await tx.driverPayout.findFirst({
                    where: {
                        driverId,
                        periodStart: start,
                        periodEnd: end,
                        status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING, PayoutStatus.PAID] },
                    },
                });
                if (existing) {
                    this.logger.warn(`Payout already exists for driver ${driverId} in this period`);
                    continue;
                }

                // ✅ Tier is now snapshotted per earning — pick dominant tier for the period
                // const tierCounts = list.reduce((acc, e) => {
                //     acc[e.vehicleTier] = (acc[e.vehicleTier] ?? 0) + 1;
                //     return acc;
                // }, {} as Record<string, number>);

                // const tier = (Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
                //     ?? VehicleType.CAR) as VehicleType;
                // ✅ Correct: ignore null tiers entirely
                // const tierCounts = list.reduce((acc, e) => {
                //     if (e.vehicleTier) {
                //         acc[e.vehicleTier] = (acc[e.vehicleTier] ?? 0) + 1;
                //     }
                //     return acc;
                // }, {} as Record<VehicleType, number>);

                // const dominantTierEntry = Object.entries(tierCounts)
                //     .sort((a, b) => b[1] - a[1])[0];

                // const tier: VehicleType =
                //     (dominantTierEntry?.[0] as VehicleType | undefined) ?? VehicleType.CAR;
                // const tier: VehicleType | null =
                //     (dominantTierEntry?.[0] as VehicleType | undefined) ?? null;

                const tierCounts = list.reduce((acc, e) => {
                    if (e.vehicleTier) {
                        acc[e.vehicleTier] = (acc[e.vehicleTier] ?? 0) + 1;
                    }
                    return acc;
                }, {} as Record<VehicleType, number>);

                const dominantTierEntry = Object.entries(tierCounts)
                    .sort((a, b) => b[1] - a[1])[0];

                const tier: VehicleType =
                    (dominantTierEntry?.[0] as VehicleType | undefined) ?? VehicleType.CAR;

                const tripCount = list.length;
                const grossEarnings = list.reduce((s, e) => s + Number(e.grossAmount), 0);
                const tipTotal = list.reduce((s, e) => s + Number(e.tips), 0);
                const commissionAmount = list.reduce((s, e) => s + Number(e.commissionAmount), 0);
                const commissionPct = grossEarnings > 0 ? (commissionAmount / grossEarnings) * 100 : 0;
                const netPayout = grossEarnings - commissionAmount + tipTotal;

                const payoutNumber = await this.nextPayoutNumber(tx);

                const payout = await tx.driverPayout.create({

                    data: {
                        payoutNumber,
                        reference: `AUTO-${randomUUID()}`,
                        amount: Number(netPayout.toFixed(2)),
                        bankSnapshot: {},
                        driver: { connect: { id: driverId } },
                        vehicleTier: tier,
                        tripCount,
                        grossEarnings: new Prisma.Decimal(grossEarnings.toFixed(2)),
                        commissionPct: new Prisma.Decimal(commissionPct.toFixed(2)),
                        commissionAmount: new Prisma.Decimal(commissionAmount.toFixed(2)),
                        tipTotal: new Prisma.Decimal(tipTotal.toFixed(2)),
                        netPayout: new Prisma.Decimal(netPayout.toFixed(2)),
                        status: PayoutStatus.PENDING,
                        periodStart: start,
                        periodEnd: end,
                        approvedBy: { connect: { id: adminId } },
                        approvedAt: new Date(),
                    },
                });

                await tx.driverEarning.updateMany({
                    where: { id: { in: list.map((e) => e.id) } },
                    data: { payoutId: payout.id },
                });

                created.push(payout);
            }
        });

        return {
            success: true,
            message: `${created.length} payout(s) generated`,
            data: created.map((p) => this.mapPayout(p)),
        };
    }

    private async nextPayoutNumber(tx: Prisma.TransactionClient): Promise<string> {
        // Use a Postgres sequence (create once via migration):
        // CREATE SEQUENCE IF NOT EXISTS driver_payout_seq;
        const rows = await tx.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('driver_payout_seq') AS nextval
  `;
        const n = Number(rows[0].nextval);
        return `PO-${n.toString().padStart(4, '0')}`;
    }

    private async nextPayoutNumberbk(tx: Prisma.TransactionClient): Promise<string> {
        // Simple sequential counter using count of payouts
        const count = await tx.driverPayout.count();
        const next = (count + 1).toString().padStart(4, '0');
        return `PO-${next}`;
    }

    // ------------------------------------------------------------------
    // 4. Update payout status (Process, Mark Paid, Cancel, Fail)
    // ------------------------------------------------------------------
    async updateStatus(payoutId: string, dto: UpdatePayoutStatusDto, adminId: string) {
        const payout = await this.prisma.driverPayout.findUnique({
            where: { id: payoutId },
            include: {
                earnings: true,
                driver: { include: { bankAccount: true } },
            },
        });
        if (!payout) throw new NotFoundException('Payout not found');

        // Validate transitions
        const validTransitions: Record<PayoutStatus, PayoutStatus[]> = {
            PENDING: [PayoutStatus.PROCESSING, PayoutStatus.CANCELLED, PayoutStatus.FAILED],
            PROCESSING: [PayoutStatus.PAID, PayoutStatus.FAILED],
            PAID: [],
            FAILED: [PayoutStatus.PENDING],
            CANCELLED: [],
        };
        if (!validTransitions[payout.status].includes(dto.status)) {
            throw new BadRequestException(
                `Invalid transition: ${payout.status} → ${dto.status}`,
            );
        }

        return this.prisma.$transaction(async (tx) => {
            const updateData: Prisma.DriverPayoutUpdateInput = { status: dto.status };

            if (dto.reference) updateData.reference = dto.reference;
            if (dto.note) updateData.note = dto.note;
            // if (dto.status === PayoutStatus.PAID) {
            //     updateData.paidAt = new Date();
            // }
            // When moving PROCESSING → PAID, disburse via Monnify
            if (dto.status === PayoutStatus.PAID && payout.status === PayoutStatus.PROCESSING) {
                if (!payout.driver.bankAccount) {
                    throw new BadRequestException('Driver has no verified bank account');
                }

                const transferRef = `PAYOUT-${payout.payoutNumber}-${Date.now()}`;

                const transferResult = await this.monnifyService.initiateTransfer({
                    amount: Number(payout.netPayout),
                    reference: transferRef,
                    narration: `Driver payout ${payout.payoutNumber}`,
                    destinationBankCode: payout.driver.bankAccount.bankCode,
                    destinationAccountNumber: payout.driver.bankAccount.accountNumber,
                    destinationAccountName: payout.driver.bankAccount.accountName,
                    sourceAccountNumber: this.configService.get('MONNIFY_SOURCE_ACCOUNT'),
                });

                // Update with Monnify's reference
                return this.prisma.driverPayout.update({
                    where: { id: payoutId },
                    data: {
                        status: PayoutStatus.PAID,
                        paidAt: new Date(),
                        reference: transferResult.transactionReference ?? transferRef,
                        note: dto.note ?? `Disbursed via Monnify`,
                    },
                });
            }
            if (dto.status === PayoutStatus.FAILED && dto.failureReason) {
                updateData.failureReason = dto.failureReason;
            }

            const updated = await tx.driverPayout.update({
                where: { id: payoutId },
                data: updateData,
            });

            // If cancelled, release earnings back to the pool
            if (dto.status === PayoutStatus.CANCELLED) {
                await tx.driverEarning.updateMany({
                    where: { payoutId },
                    data: { payoutId: null },
                });
            }

            return {
                success: true,
                message: `Payout ${payout.payoutNumber} moved to ${dto.status}`,
                data: this.mapPayout(updated),
            };
        });
    }

    // ------------------------------------------------------------------
    // 5. CSV export
    // ------------------------------------------------------------------
    async exportCsv(dto: ListPayoutsDto): Promise<string> {
        const { status, search, tier, from, to } = dto;
        const where: Prisma.DriverPayoutWhereInput = {};
        if (status) where.status = status;
        if (tier) where.vehicleTier = tier;
        if (from || to) {
            where.periodStart = {};
            if (from) where.periodStart.gte = new Date(from);
            if (to) where.periodEnd = { lte: new Date(to) };
        }
        if (search) {
            where.OR = [
                { payoutNumber: { contains: search, mode: 'insensitive' } },
                { driver: { firstName: { contains: search, mode: 'insensitive' } } },
                { driver: { lastName: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const rows = await this.prisma.driverPayout.findMany({
            where,
            include: { driver: { select: { firstName: true, lastName: true, email: true } } },
            orderBy: { createdAt: 'desc' },
        });

        const header = [
            'Payout ID', 'Driver', 'Email', 'Tier', 'Trips', 'Gross', 'Commission %',
            'Commission', 'Tips', 'Net Payout', 'Status', 'Period Start', 'Period End', 'Paid At',
        ].join(',');

        const body = rows.map((r) =>
            [
                r.payoutNumber,
                `${r.driver.firstName ?? ''} ${r.driver.lastName ?? ''}`.trim(),
                r.driver.email,
                r.vehicleTier,
                r.tripCount,
                Number(r.grossEarnings).toFixed(2),
                Number(r.commissionPct).toFixed(2),
                Number(r.commissionAmount).toFixed(2),
                Number(r.tipTotal).toFixed(2),
                Number(r.netPayout).toFixed(2),
                r.status,
                r.periodStart.toISOString(),
                r.periodEnd.toISOString(),
                r.paidAt?.toISOString() ?? '',
            ]
                .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                .join(','),
        ).join('\n');

        return `${header}\n${body}`;
    }
}