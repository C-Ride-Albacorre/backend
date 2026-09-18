import { Injectable, Logger } from '@nestjs/common';
import { CommissionStatus, OrderStatus, PaymentStatus, Prisma, SettlementStatus } from '@prisma/client';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class VendorSettlementService {
  private readonly logger = new Logger(VendorSettlementService.name);

  constructor(private readonly prisma: PrismaService) {}



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

  async generateForPeriod(
    periodStart: Date,
    periodEnd: Date,
) {
    let vendorsProcessed = 0;
    let ordersProcessed = 0;
    let settlementsCreated = 0;

    this.logger.log(
        `Starting settlement generation. Period: ${periodStart.toISOString()} -> ${periodEnd.toISOString()}`,
    );

    try {
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

        this.logger.log(
            `Found ${vendors.length} vendor(s) with at least one store.`,
        );

        for (const vendor of vendors) {
            const vendorName =
                `${vendor.firstName ?? ''} ${vendor.lastName ?? ''}`.trim() ||
                'Unknown Vendor';

            this.logger.log(
                `Processing vendor ${vendor.id} (${vendorName}). ` +
                `Stores: ${vendor.stores.length}, ` +
                `Active commissions: ${vendor.commissions.length}`,
            );

            const commission = vendor.commissions[0];

            if (!commission) {
                this.logger.warn(
                    `Skipping vendor ${vendor.id} (${vendorName}): no active commission found.`,
                );
                continue;
            }

            vendorsProcessed++;

            const commissionPct = Number(
                commission.vendorCommission,
            );

            const servicePct = Number(
                commission.serviceCharge,
            );

            this.logger.debug(
                `Vendor ${vendor.id} commission configuration: ` +
                `vendorCommission=${commissionPct}%, ` +
                `serviceCharge=${servicePct}%`,
            );

            const storeSummary = vendor.stores
                .map(
                    (store) =>
                        `${store.id} (${store.storeName})`,
                )
                .join(', ');

            this.logger.debug(
                `Vendor ${vendor.id} stores: ${storeSummary || 'none'}`,
            );

            try {
                const result = await this.prisma.$transaction(
                    async (tx) => {
                        this.logger.debug(
                            `Searching eligible orders for vendor ${vendor.id}. ` +
                            `PaymentStatus=${PaymentStatus.PAID}, ` +
                            `OrderStatus=${OrderStatus.DELIVERED}, ` +
                            `Period=${periodStart.toISOString()} -> ${periodEnd.toISOString()}, ` +
                            `settlementId=null`,
                        );

                        const eligibleOrders =
                            await tx.order.findMany({
                                where: {
                                    paymentStatus:
                                        PaymentStatus.PAID,

                                    orderStatus:
                                        OrderStatus.DELIVERED,

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
                                    paymentStatus: true,
                                    orderStatus: true,
                                    deliveredAt: true,
                                    settlementId: true,

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

                        this.logger.log(
                            `Vendor ${vendor.id}: found ${eligibleOrders.length} eligible order(s).`,
                        );

                        if (eligibleOrders.length === 0) {
                            this.logger.warn(
                                `Vendor ${vendor.id}: no eligible orders found for period.`,
                            );

                            return {
                                ordersProcessed: 0,
                                settlementsCreated: 0,
                            };
                        }

                        this.logger.debug(
                            `Vendor ${vendor.id} eligible order IDs: ` +
                            eligibleOrders
                                .map((order) => order.id)
                                .join(', '),
                        );

                        const perStore = new Map<
                            string,
                            { orders: number; gross: number }
                        >();

                        for (const order of eligibleOrders) {
                            const storesInOrder =
                                new Set<string>();

                            this.logger.debug(
                                `Processing order ${order.id} for vendor ${vendor.id}. ` +
                                `Items: ${order.items.length}, ` +
                                `deliveredAt=${order.deliveredAt?.toISOString() ?? 'null'}`,
                            );

                            for (const item of order.items) {
                                if (!item.storeId) {
                                    this.logger.warn(
                                        `Order ${order.id} contains an item without storeId. ` +
                                        `Skipping item.`,
                                    );
                                    continue;
                                }

                                const itemTotal =
                                    Number(item.totalPrice);

                                const bucket =
                                    perStore.get(item.storeId) ?? {
                                        orders: 0,
                                        gross: 0,
                                    };

                                bucket.gross += itemTotal;

                                perStore.set(
                                    item.storeId,
                                    bucket,
                                );

                                storesInOrder.add(
                                    item.storeId,
                                );

                                this.logger.debug(
                                    `Order ${order.id}: ` +
                                    `store=${item.storeId}, ` +
                                    `itemTotal=${itemTotal}`,
                                );
                            }

                            // Count an order once per store.
                            for (const storeId of storesInOrder) {
                                const bucket =
                                    perStore.get(storeId)!;

                                bucket.orders += 1;
                            }
                        }

                        this.logger.log(
                            `Vendor ${vendor.id}: aggregated data for ${perStore.size} store(s).`,
                        );

                        for (const [
                            storeId,
                            totals,
                        ] of perStore) {
                            this.logger.debug(
                                `Store ${storeId}: ` +
                                `orders=${totals.orders}, ` +
                                `gross=${totals.gross}`,
                            );
                        }

                        let vendorAggregate = {
                            orders: 0,
                            gross: 0,
                            commission: 0,
                            service: 0,
                            net: 0,
                        };

                        let settlementsCreatedForVendor = 0;

                        // Create store-level settlement rows
                        for (const [
                            storeId,
                            totals,
                        ] of perStore) {
                            const commissionAmt =
                                (totals.gross *
                                    commissionPct) /
                                100;

                            const serviceAmt =
                                (totals.gross *
                                    servicePct) /
                                100;

                            const net =
                                totals.gross -
                                commissionAmt -
                                serviceAmt;

                            this.logger.log(
                                `Creating store settlement. ` +
                                `Vendor=${vendor.id}, ` +
                                `Store=${storeId}, ` +
                                `Orders=${totals.orders}, ` +
                                `Gross=${totals.gross}, ` +
                                `Commission=${commissionAmt}, ` +
                                `Service=${serviceAmt}, ` +
                                `Net=${net}`,
                            );

                            const storeSettlement =
                                await tx.vendorSettlement.create({
                                    data: {
                                        reference:
                                            await this.nextReference(
                                                tx,
                                            ),

                                        vendorId:
                                            vendor.id,

                                        storeId,

                                        periodStart,
                                        periodEnd,

                                        dueDate:
                                            this.dueDateFor(
                                                periodEnd,
                                            ),

                                        totalOrders:
                                            totals.orders,

                                        grossSales:
                                            this.round2(
                                                totals.gross,
                                            ),

                                        commission:
                                            this.round2(
                                                commissionAmt,
                                            ),

                                        serviceCharge:
                                            this.round2(
                                                serviceAmt,
                                            ),

                                        netSettlement:
                                            this.round2(net),

                                        status:
                                            SettlementStatus.PENDING,
                                    },
                                });

                            settlementsCreatedForVendor++;

                            this.logger.log(
                                `Created store settlement ${storeSettlement.id} ` +
                                `(reference=${storeSettlement.reference}) ` +
                                `for vendor ${vendor.id}, store ${storeId}.`,
                            );

                            vendorAggregate.orders +=
                                totals.orders;

                            vendorAggregate.gross +=
                                totals.gross;

                            vendorAggregate.commission +=
                                commissionAmt;

                            vendorAggregate.service +=
                                serviceAmt;

                            vendorAggregate.net += net;
                        }

                        this.logger.log(
                            `Vendor ${vendor.id} aggregate: ` +
                            `orders=${vendorAggregate.orders}, ` +
                            `gross=${vendorAggregate.gross}, ` +
                            `commission=${vendorAggregate.commission}, ` +
                            `service=${vendorAggregate.service}, ` +
                            `net=${vendorAggregate.net}`,
                        );

                        // Create vendor-level aggregate
                        const aggregateRow =
                            await tx.vendorSettlement.create({
                                data: {
                                    reference:
                                        await this.nextReference(
                                            tx,
                                        ),

                                    vendorId:
                                        vendor.id,

                                    storeId: null,

                                    periodStart,
                                    periodEnd,

                                    dueDate:
                                        this.dueDateFor(
                                            periodEnd,
                                        ),

                                    totalOrders:
                                        vendorAggregate.orders,

                                    grossSales:
                                        this.round2(
                                            vendorAggregate.gross,
                                        ),

                                    commission:
                                        this.round2(
                                            vendorAggregate.commission,
                                        ),

                                    serviceCharge:
                                        this.round2(
                                            vendorAggregate.service,
                                        ),

                                    netSettlement:
                                        this.round2(
                                            vendorAggregate.net,
                                        ),

                                    status:
                                        SettlementStatus.PENDING,
                                },
                            });

                        settlementsCreatedForVendor++;

                        this.logger.log(
                            `Created vendor aggregate settlement ${aggregateRow.id} ` +
                            `(reference=${aggregateRow.reference}) ` +
                            `for vendor ${vendor.id}.`,
                        );

                        // Mark orders as settled
                        const orderIds =
                            eligibleOrders.map(
                                (order) => order.id,
                            );

                        const updateResult =
                            await tx.order.updateMany({
                                where: {
                                    id: {
                                        in: orderIds,
                                    },
                                },

                                data: {
                                    settledAt: new Date(),
                                    settlementId:
                                        aggregateRow.id,
                                },
                            });

                        this.logger.log(
                            `Marked ${updateResult.count} order(s) as settled ` +
                            `for vendor ${vendor.id}. ` +
                            `Settlement=${aggregateRow.id}`,
                        );

                        return {
                            ordersProcessed:
                                eligibleOrders.length,

                            settlementsCreated:
                                settlementsCreatedForVendor,
                        };
                    },
                );

                ordersProcessed +=
                    result.ordersProcessed;

                settlementsCreated +=
                    result.settlementsCreated;

                this.logger.log(
                    `Completed vendor ${vendor.id}: ` +
                    `ordersProcessed=${result.ordersProcessed}, ` +
                    `settlementsCreated=${result.settlementsCreated}`,
                );
            } catch (error) {
                this.logger.error(
                    `Failed to generate settlement for vendor ${vendor.id} (${vendorName}).`,
                    error instanceof Error
                        ? error.stack
                        : String(error),
                );

                throw error;
            }
        }

        const summary = {
            periodStart,
            periodEnd,
            vendorsProcessed,
            ordersProcessed,
            settlementsCreated,
        };

        this.logger.log(
            `Settlement generation completed. ` +
            `vendorsProcessed=${vendorsProcessed}, ` +
            `ordersProcessed=${ordersProcessed}, ` +
            `settlementsCreated=${settlementsCreated}`,
        );

        this.logger.debug(
            `Settlement generation summary: ${JSON.stringify(
                summary,
                null,
                2,
            )}`,
        );

        return summary;
    } catch (error) {
        this.logger.error(
            `Settlement generation failed for period ${periodStart.toISOString()} -> ${periodEnd.toISOString()}.`,
            error instanceof Error ? error.stack : String(error),
        );
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


