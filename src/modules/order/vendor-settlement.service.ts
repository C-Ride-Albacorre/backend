import { Injectable, Logger } from '@nestjs/common';
import { CommissionStatus, OrderStatus, PaymentStatus, Prisma, SettlementStatus } from '@prisma/client';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class VendorSettlementService {
    private readonly logger = new Logger(VendorSettlementService.name);

    constructor(private readonly prisma: PrismaService) { }

    async generateForPeriod(
        periodStart: Date,
        periodEnd: Date,
    ) {
        let vendorsProcessed = 0;
        let ordersProcessed = 0;
        let settlementsCreated = 0;

        const vendors = await this.prisma.user.findMany({
            where: {
                role: 'VENDOR',
                stores: { some: {} },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                stores: {
                    select: {
                        id: true,
                        storeName: true,
                    },
                },
                commissions: {
                    where: {
                        status: CommissionStatus.ACTIVE,
                    },
                    orderBy: {
                        updatedAt: 'desc',
                    },
                    take: 1,
                    select: {
                        vendorCommission: true,
                        serviceCharge: true,
                    },
                },
            },
        });

        for (const vendor of vendors) {
            const commission = vendor.commissions[0];

            if (!commission) continue;

            vendorsProcessed++;

            const commissionPct = Number(commission.vendorCommission);
            const servicePct = Number(commission.serviceCharge);

            const result = await this.prisma.$transaction(async (tx) => {
                const eligibleOrders = await tx.order.findMany({
                    where: {
                        paymentStatus: PaymentStatus.PAID,
                        orderStatus: OrderStatus.DELIVERED,
                        deliveredAt: {
                            gte: periodStart,
                            lte: periodEnd,
                        },
                        settlementId: null,
                        items: {
                            some: {
                                store: {
                                    userId: vendor.id,
                                },
                            },
                        },
                    },
                    select: {
                        id: true,
                        items: {
                            where: {
                                store: {
                                    userId: vendor.id,
                                },
                            },
                            select: {
                                storeId: true,
                                totalPrice: true,
                            },
                        },
                    },
                });

                if (eligibleOrders.length === 0) {
                    return {
                        ordersProcessed: 0,
                        settlementsCreated: 0,
                    };
                }

                const perStore = new Map<
                    string,
                    { orders: number; gross: number }
                >();

                for (const order of eligibleOrders) {
                    const storesInOrder = new Set<string>();

                    for (const item of order.items) {
                        if (!item.storeId) continue;

                        const bucket = perStore.get(item.storeId) ?? {
                            orders: 0,
                            gross: 0,
                        };

                        bucket.gross += Number(item.totalPrice);

                        perStore.set(item.storeId, bucket);
                        storesInOrder.add(item.storeId);
                    }

                    for (const storeId of storesInOrder) {
                        const bucket = perStore.get(storeId)!;
                        bucket.orders += 1;
                    }
                }

                let vendorAggregate = {
                    orders: 0,
                    gross: 0,
                    commission: 0,
                    service: 0,
                    net: 0,
                };

                let settlementsCreated = 0;

                // Create store-level settlement rows
                for (const [storeId, totals] of perStore) {
                    const commissionAmt =
                        (totals.gross * commissionPct) / 100;

                    const serviceAmt =
                        (totals.gross * servicePct) / 100;

                    const net =
                        totals.gross - commissionAmt - serviceAmt;

                    await tx.vendorSettlement.create({
                        data: {
                            reference: await this.nextReference(tx),
                            vendorId: vendor.id,
                            storeId,
                            periodStart,
                            periodEnd,
                            dueDate: this.dueDateFor(periodEnd),
                            totalOrders: totals.orders,
                            grossSales: this.round2(totals.gross),
                            commission: this.round2(commissionAmt),
                            serviceCharge: this.round2(serviceAmt),
                            netSettlement: this.round2(net),
                            status: SettlementStatus.PENDING,
                        },
                    });

                    settlementsCreated++;

                    vendorAggregate.orders += totals.orders;
                    vendorAggregate.gross += totals.gross;
                    vendorAggregate.commission += commissionAmt;
                    vendorAggregate.service += serviceAmt;
                    vendorAggregate.net += net;
                }

                // Create vendor-level aggregate
                const aggregateRow =
                    await tx.vendorSettlement.create({
                        data: {
                            reference: await this.nextReference(tx),
                            vendorId: vendor.id,
                            storeId: null,
                            periodStart,
                            periodEnd,
                            dueDate: this.dueDateFor(periodEnd),
                            totalOrders: vendorAggregate.orders,
                            grossSales: this.round2(vendorAggregate.gross),
                            commission: this.round2(vendorAggregate.commission),
                            serviceCharge: this.round2(vendorAggregate.service),
                            netSettlement: this.round2(vendorAggregate.net),
                            status: SettlementStatus.PENDING,
                        },
                    });

                settlementsCreated++;

                // Mark orders as settled
                await tx.order.updateMany({
                    where: {
                        id: {
                            in: eligibleOrders.map((o) => o.id),
                        },
                    },
                    data: {
                        settledAt: new Date(),
                        settlementId: aggregateRow.id,
                    },
                });

                return {
                    ordersProcessed: eligibleOrders.length,
                    settlementsCreated,
                };
            });

            ordersProcessed += result.ordersProcessed;
            settlementsCreated += result.settlementsCreated;
        }

        return {
            periodStart,
            periodEnd,
            vendorsProcessed,
            ordersProcessed,
            settlementsCreated,
        };
    }


    async generateForPeriodbk(periodStart: Date, periodEnd: Date) {
        const vendors = await this.prisma.user.findMany({
            where: {
                role: 'VENDOR',
                stores: { some: {} },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                stores: {
                    select: {
                        id: true,
                        storeName: true,
                    },
                },
                commissions: {
                    where: {
                        status: CommissionStatus.ACTIVE,
                    },
                    orderBy: {
                        updatedAt: 'desc',
                    },
                    take: 1,
                    select: {
                        vendorCommission: true,
                        serviceCharge: true,
                    },
                },
            },
        });

        for (const vendor of vendors) {
            const commission = vendor.commissions[0];

            if (!commission) continue;

            const commissionPct = Number(commission.vendorCommission);
            const servicePct = Number(commission.serviceCharge);

            await this.prisma.$transaction(async (tx) => {
                const eligibleOrders = await tx.order.findMany({
                    where: {
                        paymentStatus: PaymentStatus.PAID,
                        orderStatus: OrderStatus.DELIVERED,
                        deliveredAt: {
                            gte: periodStart,
                            lte: periodEnd,
                        },
                        settlementId: null,
                        items: {
                            some: {
                                store: {
                                    userId: vendor.id,
                                },
                            },
                        },
                    },
                    select: {
                        id: true,
                        items: {
                            where: {
                                store: {
                                    userId: vendor.id,
                                },
                            },
                            select: {
                                storeId: true,
                                totalPrice: true,
                            },
                        },
                    },
                });

                if (eligibleOrders.length === 0) return;

                const perStore = new Map<
                    string,
                    { orders: number; gross: number }
                >();

                for (const order of eligibleOrders) {
                    const storesInOrder = new Set<string>();

                    for (const item of order.items) {
                        if (!item.storeId) continue;

                        const bucket = perStore.get(item.storeId) ?? {
                            orders: 0,
                            gross: 0,
                        };

                        bucket.gross += Number(item.totalPrice);

                        perStore.set(item.storeId, bucket);
                        storesInOrder.add(item.storeId);
                    }

                    for (const storeId of storesInOrder) {
                        const bucket = perStore.get(storeId)!;
                        bucket.orders += 1;
                    }
                }

                let vendorAggregate = {
                    orders: 0,
                    gross: 0,
                    commission: 0,
                    service: 0,
                    net: 0,
                };

                for (const [storeId, totals] of perStore) {
                    const commissionAmt =
                        (totals.gross * commissionPct) / 100;

                    const serviceAmt =
                        (totals.gross * servicePct) / 100;

                    const net =
                        totals.gross - commissionAmt - serviceAmt;

                    await tx.vendorSettlement.create({
                        data: {
                            reference: await this.nextReference(tx),
                            vendorId: vendor.id,
                            storeId,
                            periodStart,
                            periodEnd,
                            dueDate: this.dueDateFor(periodEnd),
                            totalOrders: totals.orders,
                            grossSales: this.round2(totals.gross),
                            commission: this.round2(commissionAmt),
                            serviceCharge: this.round2(serviceAmt),
                            netSettlement: this.round2(net),
                            status: SettlementStatus.PENDING,
                        },
                    });

                    vendorAggregate.orders += totals.orders;
                    vendorAggregate.gross += totals.gross;
                    vendorAggregate.commission += commissionAmt;
                    vendorAggregate.service += serviceAmt;
                    vendorAggregate.net += net;
                }

                const aggregateRow =
                    await tx.vendorSettlement.create({
                        data: {
                            reference: await this.nextReference(tx),
                            vendorId: vendor.id,
                            storeId: null,
                            periodStart,
                            periodEnd,
                            dueDate: this.dueDateFor(periodEnd),
                            totalOrders: vendorAggregate.orders,
                            grossSales: this.round2(vendorAggregate.gross),
                            commission: this.round2(vendorAggregate.commission),
                            serviceCharge: this.round2(vendorAggregate.service),
                            netSettlement: this.round2(vendorAggregate.net),
                            status: SettlementStatus.PENDING,
                        },
                    });

                await tx.order.updateMany({
                    where: {
                        id: {
                            in: eligibleOrders.map((o) => o.id),
                        },
                    },
                    data: {
                        settledAt: new Date(),
                        settlementId: aggregateRow.id,
                    },
                });
            });
        }
    }

    private async nextReference(
        tx: Prisma.TransactionClient,
    ): Promise<string> {
        const count = await tx.vendorSettlement.count();
        return `vs${count + 1}`;
    }

    private dueDateFor(periodEnd: Date): Date {
        const d = new Date(periodEnd);
        d.setDate(d.getDate() + 3);
        return d;
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }
}
