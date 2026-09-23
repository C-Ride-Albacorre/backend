import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import {
    CommissionStatus,
    OrderStatus,
    PaymentStatus,
    Prisma,
    SettlementStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';
import {
    DailyEarningsDto,
    OrderEarningRowDto,
    StatementHistoryItemDto,
    VendorEarningsFilterDto,
    VendorStatementDto,
} from './dto/vendor-earnings.dto';

@Injectable()
export class VendorService {
    private readonly logger = new Logger(VendorService.name);

    constructor(private readonly prisma: PrismaService) { }

    // ─────────────────────────────────────────────────────────────
    // VEN-024/025/026 — Weekly statement (live, from orders)
    // ─────────────────────────────────────────────────────────────
    async getStatement(
        vendorId: string,
        filter: VendorEarningsFilterDto,
    ): Promise<VendorStatementDto> {
        const { periodStart, periodEnd, storeId } = filter;

        if (!periodStart || !periodEnd) {
            throw new BadRequestException(
                'periodStart and periodEnd are required',
            );
        }

        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        if (start > end) {
            throw new BadRequestException('periodStart must be before periodEnd');
        }

        const vendor = await this.loadVendorWithCommission(vendorId);
        if (!vendor.commissions.length) {
            throw new NotFoundException('No active commission configuration found');
        }

        const commissionPct = Number(vendor.commissions[0].vendorCommission);
        const servicePct = Number(vendor.commissions[0].serviceCharge);

        const storeIds = vendor.stores.map((s) => s.id);
        if (storeId && !storeIds.includes(storeId)) {
            throw new ForbiddenException('Store does not belong to this vendor');
        }

        const itemStoreFilter = storeId
            ? { storeId }
            : { storeId: { in: storeIds } };

        // Eligible orders = PAID + DELIVERED within period (settled or not,
        // because the vendor should see their expected earnings regardless).
        const orders = await this.prisma.order.findMany({
            where: {
                paymentStatus: PaymentStatus.PAID,
                orderStatus: OrderStatus.DELIVERED,
                deliveredAt: { gte: start, lte: end },
                items: { some: itemStoreFilter },
            },
            select: {
                id: true,
                orderNumber: true,
                deliveredAt: true,
                items: {
                    where: itemStoreFilter,
                    select: { totalPrice: true },
                },
            },
            orderBy: { deliveredAt: 'asc' },
        });

        const orderRows: OrderEarningRowDto[] = [];
        const dayMap = new Map<string, DailyEarningsDto>();

        let totalGross = 0;
        let totalCommission = 0;
        let totalService = 0;
        let totalNet = 0;

        for (const order of orders) {
            const orderValue = order.items.reduce(
                (sum, it) => sum + Number(it.totalPrice),
                0,
            );
            const commission = this.round2((orderValue * commissionPct) / 100);
            const service = this.round2((orderValue * servicePct) / 100);
            const net = this.round2(orderValue - commission - service);

            totalGross += orderValue;
            totalCommission += commission;
            totalService += service;
            totalNet += net;

            orderRows.push({
                orderId: order.id,
                reference: order.orderNumber,
                deliveredAt: order.deliveredAt!,
                orderValue: this.round2(orderValue),
                commission,
                serviceCharge: service,
                netEarning: net,
            });

            const key = this.dateKey(order.deliveredAt!);
            const existing =
                dayMap.get(key) ??
                ({
                    date: key,
                    day: this.dayLabel(order.deliveredAt!),
                    orderCount: 0,
                    gross: 0,
                    commission: 0,
                    serviceCharge: 0,
                    vendorEarnings: 0,
                } as DailyEarningsDto);

            existing.orderCount += 1;
            existing.gross = this.round2(existing.gross + orderValue);
            existing.commission = this.round2(existing.commission + commission);
            existing.serviceCharge = this.round2(existing.serviceCharge + service);
            existing.vendorEarnings = this.round2(existing.vendorEarnings + net);
            dayMap.set(key, existing);
        }

        // If a persisted settlement exists for this exact period, surface its status.
        const settlement = await this.prisma.vendorSettlement.findFirst({
            where: {
                vendorId,
                storeId: storeId ?? null,
                periodStart: start,
                periodEnd: end,
            },
            select: { status: true },
        });

        const days = Array.from(dayMap.values()).sort((a, b) =>
            a.date.localeCompare(b.date),
        );

        return {
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
            weekLabel: this.formatPeriod(start, end),
            totalOrders: orderRows.length,
            totalGross: this.round2(totalGross),
            totalCommission: this.round2(totalCommission),
            totalServiceCharge: this.round2(totalService),
            totalVendorEarnings: this.round2(totalNet),
            status: settlement?.status ?? 'IN_PROGRESS',
            days,
            orders: orderRows,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // VEN-023 — Per-order breakdown
    // ─────────────────────────────────────────────────────────────
    async getOrderEarnings(vendorId: string, orderId: string) {
        const vendor = await this.loadVendorWithCommission(vendorId);
        if (!vendor.commissions.length) {
            throw new NotFoundException('No active commission configuration found');
        }

        const commissionPct = Number(vendor.commissions[0].vendorCommission);
        const servicePct = Number(vendor.commissions[0].serviceCharge);

        const order = await this.prisma.order.findFirst({
            where: {
                id: orderId,
                items: { some: { store: { userId: vendorId } } },
            },
            select: {
                id: true,
                orderNumber: true,
                deliveredAt: true,
                paymentStatus: true,
                orderStatus: true,
                items: {
                    where: { store: { userId: vendorId } },
                    select: {
                        id: true,
                        quantity: true,
                        unitPrice: true,
                        totalPrice: true,
                        store: { select: { id: true, storeName: true } },
                        product: { select: { id: true, productName: true } },
                    },
                },
            },
        });

        if (!order) throw new NotFoundException('Order not found for this vendor');

        let gross = 0;
        const lineItems = order.items.map((it) => {
            const line = Number(it.totalPrice);
            gross += line;
            const commission = this.round2((line * commissionPct) / 100);
            const service = this.round2((line * servicePct) / 100);
            return {
                itemId: it.id,
                productName: it.product?.productName ?? null,
                storeName: it.store?.storeName ?? null,
                quantity: it.quantity,
                unitPrice: Number(it.unitPrice),
                lineTotal: this.round2(line),
                commission,
                serviceCharge: service,
                netEarning: this.round2(line - commission - service),
            };
        });

        const commission = this.round2((gross * commissionPct) / 100);
        const service = this.round2((gross * servicePct) / 100);
        const net = this.round2(gross - commission - service);

        return {
            orderId: order.id,
            reference: order.orderNumber,
            deliveredAt: order.deliveredAt,
            paymentStatus: order.paymentStatus,
            orderStatus: order.orderStatus,
            commissionRate: commissionPct,
            serviceChargeRate: servicePct,
            totals: {
                gross: this.round2(gross),
                commission,
                serviceCharge: service,
                netEarning: net,
            },
            items: lineItems,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // VEN-027 — Historical statements (persisted settlements)
    // ─────────────────────────────────────────────────────────────
    async getStatementHistory(
        vendorId: string,
        filter: VendorEarningsFilterDto,
    ): Promise<StatementHistoryItemDto[]> {
        const where: Prisma.VendorSettlementWhereInput = {
            vendorId,
            storeId: null, // vendor-level aggregates only
        };

        if (filter.status) where.status = filter.status;

        if (filter.periodStart || filter.periodEnd) {
            where.AND = [
                ...(filter.periodStart
                    ? [{ periodStart: { gte: new Date(filter.periodStart) } }]
                    : []),
                ...(filter.periodEnd
                    ? [{ periodEnd: { lte: new Date(filter.periodEnd) } }]
                    : []),
            ];
        }

        const rows = await this.prisma.vendorSettlement.findMany({
            where,
            orderBy: { periodEnd: 'desc' },
            select: {
                id: true,
                reference: true,
                periodStart: true,
                periodEnd: true,
                totalOrders: true,
                grossSales: true,
                commission: true,
                serviceCharge: true,
                netSettlement: true,
                status: true,
                dueDate: true,
            },
        });

        return rows.map((r) => ({
            id: r.id,
            reference: r.reference,
            periodStart: r.periodStart.toISOString(),
            periodEnd: r.periodEnd.toISOString(),
            weekLabel: this.formatPeriod(r.periodStart, r.periodEnd),
            totalOrders: r.totalOrders,
            grossSales: Number(r.grossSales),
            commission: Math.abs(Number(r.commission)),
            serviceCharge: Math.abs(Number(r.serviceCharge)),
            netSettlement: Number(r.netSettlement),
            status: r.status,
            dueDate: r.dueDate,
        }));
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────
    private async loadVendorWithCommission(vendorId: string) {
        const vendor = await this.prisma.user.findUnique({
            where: { id: vendorId },
            select: {
                id: true,
                stores: { select: { id: true, storeName: true } },
                commissions: {
                    where: { status: CommissionStatus.ACTIVE },
                    orderBy: { updatedAt: 'desc' },
                    take: 1,
                    select: { vendorCommission: true, serviceCharge: true },
                },
            },
        });
        if (!vendor) throw new NotFoundException('Vendor not found');
        return vendor;
    }

    private dateKey(d: Date): string {
        return d.toISOString().slice(0, 10);
    }

    private dayLabel(d: Date): string {
        return d.toLocaleDateString('en-NG', { weekday: 'short' });
    }

    private formatPeriod(start: Date, end: Date): string {
        const fmt = (d: Date) =>
            d.toLocaleString('en-NG', { month: 'short', year: 'numeric' });
        return `${fmt(start)} – ${fmt(end)}`;
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }
}