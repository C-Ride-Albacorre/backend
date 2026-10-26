
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AssignmentStatus,
  DriverStatus,
  DriverType,
  OrderStatus,
  Role,
} from '@prisma/client';

import { PrismaService } from '../../shared/services/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { QUEUES } from '../../shared/constants';
import { DriverAssignmentService } from '../driver/driver-assignment.service';
import { DriverGateway } from '../../common/map-gateway/driver.gateway';
import { MapGateway } from '../../common/map-gateway/map.gateway';

@Injectable()
export class AdminDispatchService {
  private readonly logger = new Logger(AdminDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly driverAssignment: DriverAssignmentService,
    private readonly driverGateway: DriverGateway,
    private readonly mapGateway: MapGateway,
    private readonly notification: NotificationService,
    @InjectQueue(QUEUES.NOTIFICATION)
    private readonly notificationQueue: Queue,
  ) {}


  /////

  async getDashboardStats() {
    const [
      pendingOrders,
      activeDeliveries,
      availableDrivers,
      busyDrivers,
      offlineDrivers,
    ] = await this.prisma.$transaction([
      // Pending: UNACCEPTED orders waiting for admin assignment
      this.prisma.order.count({
        where: { orderStatus: OrderStatus.UNACCEPTED },
      }),
      // Active: Assigned, Picked up, In transit
      this.prisma.order.count({
        where: {
          orderStatus: {
            in: [
              OrderStatus.ORDER_ASSIGNED,
              OrderStatus.PICKED_UP,
              OrderStatus.IN_TRANSIT,
            ],
          },
        },
      }),
      this.prisma.driverProfile.count({
        where: { status: DriverStatus.ONLINE, driverType: DriverType.PARTNER },
      }),
      this.prisma.driverProfile.count({
        where: { status: DriverStatus.BUSY, driverType: DriverType.PARTNER },
      }),
      this.prisma.driverProfile.count({
        where: { status: DriverStatus.OFFLINE, driverType: DriverType.PARTNER },
      }),
    ]);

    return {
      pendingOrders,
      activeDeliveries,
      availableDrivers,
      busyDrivers,
      offlineDrivers,
    };
  }


async getDriverFleet() {
  const drivers = await this.prisma.driverProfile.findMany({
    where: {
      driverType: DriverType.PARTNER,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          ordersAsDriver: {
            where: {
              orderStatus: {
                in: [
                  OrderStatus.ORDER_ASSIGNED,
                  OrderStatus.PICKED_UP,
                  OrderStatus.IN_TRANSIT,
                ],
              },
            },
            select: {
              id: true,
              orderNumber: true,
            },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { rating: 'desc' }],
  });

  return {
    available: drivers.filter(
      (d) => d.status === DriverStatus.ONLINE,
    ),
    onDelivery: drivers.filter(
      (d) => d.status === DriverStatus.BUSY,
    ),
    offline: drivers.filter(
      (d) => d.status === DriverStatus.OFFLINE,
    ),
  };
}

  // -------------------------------------------------------------------------
  // Order Queue (Pending & Active Tabs)
  // -------------------------------------------------------------------------

  async listOrders(tab: 'pending' | 'active', search?: string) {
    const where: any = {};

    if (tab === 'pending') {
      where.orderStatus = OrderStatus.UNACCEPTED;
    } else {
      where.orderStatus = {
        in: [OrderStatus.ORDER_ASSIGNED, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT],
      };
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: { include: { store: true } },
        user: { select: { firstName: true, lastName: true, phoneNumber: true } },
        driver: { select: { firstName: true, lastName: true, phoneNumber: true } },
      },
      take: 50,
    });

    // Format to match the UI exactly
    return orders.map((o) => {
      const store = o.items[0]?.store;
      const elapsedMins = Math.floor((Date.now() - o.createdAt.getTime()) / 60000);

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        orderType: o.orderType || 'Standard', // Express, Premium
        isVip: o.isVip || false,
        adminNotes: o.adminNotes || null,
        elapsedTime: `${elapsedMins}m ago`,
        createdAt: o.createdAt,
        store: {
          name: store?.storeName || 'Store',
          address: store?.storeAddress || 'Address not provided',
        },
        customer: {
          name: `${o.user?.firstName} ${o.user?.lastName}`,
          phone: o.user?.phoneNumber,
        },
        metrics: {
          totalAmount: o.totalAmount,
          itemCount: o.items.length,
          distanceKm: o.distanceToCustomer || 0,
          prepTimeMins: o.preparationTime || 0,
        },
        driver: o.driver
          ? {
              name: `${o.driver.firstName} ${o.driver.lastName}`,
              phone: o.driver.phoneNumber,
            }
          : null,
        status: o.orderStatus,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Assign (from the "Click to assign a driver" button)
  // -------------------------------------------------------------------------

  async manualAssign(
    orderId: string,
    adminUserId: string,
    dto: { driverId: string; reason?: string },
  ): Promise<{ success: true }> {
    await this.assertAdmin(adminUserId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { store: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.orderStatus !== OrderStatus.UNACCEPTED) {
      throw new ConflictException(`Order status is ${order.orderStatus}, expected UNACCEPTED`);
    }

    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId: dto.driverId },
    });
    if (!driverProfile) throw new NotFoundException('Driver profile not found');
    if (driverProfile.driverType !== DriverType.PARTNER) {
      throw new BadRequestException('Only PARTNER drivers can be manually assigned.');
    }
    if (driverProfile.status === DriverStatus.OFFLINE) {
      throw new BadRequestException('Driver is offline.');
    }

    // Atomic transition
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, orderStatus: OrderStatus.UNACCEPTED },
        data: {
          orderStatus: OrderStatus.ORDER_ASSIGNED,
          driverId: dto.driverId,
          driverAssignedAt: now,
          assignedByAdminId: adminUserId,
          manuallyAssignedAt: now,
          statusHistory: {
            push: {
              status: OrderStatus.ORDER_ASSIGNED,
              timestamp: now.toISOString(),
              note: 'MANUAL_ADMIN_ASSIGNMENT',
              actorId: adminUserId,
              actorRole: Role.ADMIN,
              reason: dto.reason,
            },
          },
        },
      });

      if (updated.count !== 1) return { ok: false as const };

      await tx.driverAssignment.updateMany({
        where: { orderId, assignmentStatus: AssignmentStatus.PENDING },
        data: { assignmentStatus: AssignmentStatus.ACCEPTED, driverId: dto.driverId },
      });

      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'MANUAL_ADMIN_ASSIGNMENT',
          fromStatus: OrderStatus.UNACCEPTED,
          toStatus: OrderStatus.ORDER_ASSIGNED,
          reason: dto.reason ?? null,
          metadata: { driverId: dto.driverId },
        },
      });

      return { ok: true as const };
    });

    if (!result.ok) throw new ConflictException('Order was modified concurrently');

    await this.driverAssignment.drainPendingCandidates(orderId);

    // Update Map & Driver App
    try {
      const fresh = await this.prisma.order.findUnique({ where: { id: orderId }, select: { statusHistory: true } });
      this.mapGateway.emitOrderStatus(orderId, OrderStatus.ORDER_ASSIGNED, fresh?.statusHistory ?? []);
      
      const store = order.items[0]?.store;
      await this.driverGateway.emitManualAssignment(dto.driverId, {
        orderId,
        orderNumber: order.orderNumber,
        orderStatus: OrderStatus.ORDER_ASSIGNED,
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        pickupLocation: order.pickupLocation,
        dropoffLocation: order.dropoffLocation,
        createdAt: order.createdAt,
        storeId: store?.id?.toString() ?? '',
        storeName: store?.storeName ?? 'Store',
        storeLogo: (store as any)?.storeLogo ?? '',
        storeLat: store?.latitude ?? null,
        storeLng: store?.longitude ?? null,
        manuallyAssigned: true,
        assignedByName: adminUserId,
      });
    } catch (err) {
      this.logger.warn(`Broadcast failed for ${orderId}: ${err}`);
    }

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Helper
  // -------------------------------------------------------------------------

  private async assertAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Admin access required');
    }
  }



  ////

  // -------------------------------------------------------------------------
  // List UNACCEPTED orders + available PARTNER drivers (for the admin UI)
  // -------------------------------------------------------------------------

  async listUnacceptedOrders(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, params.limit ?? 20);
    const skip = (page - 1) * limit;

    const where = {
      orderStatus: OrderStatus.UNACCEPTED,
      ...(params.search
        ? { orderNumber: { contains: params.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { unacceptedAt: 'desc' },
        skip,
        take: limit,
        include: {
          items: { include: { store: true } },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async listPartnerDrivers(params: { search?: string; onlineOnly?: boolean }) {
    const where: any = { driverType: DriverType.PARTNER };
    if (params.onlineOnly) where.status = DriverStatus.ONLINE;
    if (params.search) {
      where.OR = [
        { user: { firstName: { contains: params.search, mode: 'insensitive' } } },
        { user: { lastName:  { contains: params.search, mode: 'insensitive' } } },
        { user: { email:     { contains: params.search, mode: 'insensitive' } } },
        { user: { phoneNumber:     { contains: params.search, mode: 'insensitive' } } },
        { licensePlate:      { contains: params.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.driverProfile.findMany({
      where,
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            email: true, phoneNumber: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { rating: 'desc' }],
      take: 100,
    });
  }

  // -------------------------------------------------------------------------
  // Manually assign a PARTNER driver to an UNACCEPTED order
  // -------------------------------------------------------------------------

  async manualAssignOld(
    orderId: string,
    adminUserId: string,
    dto: { driverId: string; reason?: string },
  ): Promise<{ success: true; orderId: string; driverId: string }> {
    // 1. Validate admin
    await this.assertAdmin(adminUserId);

    // 2. Validate order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { store: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.orderStatus !== OrderStatus.UNACCEPTED) {
      throw new ConflictException(
        `Order status is ${order.orderStatus}, expected UNACCEPTED`,
      );
    }
    if (order.userId) {
      throw new ConflictException('Order already has a driver assigned');
    }

    // 3. Validate driver — MUST be PARTNER
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId: dto.driverId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!driverProfile) throw new NotFoundException('Driver profile not found');
    if (driverProfile.driverType !== DriverType.PARTNER) {
      throw new BadRequestException(
        `Only PARTNER drivers can be manually assigned. ` +
          `Driver ${dto.driverId} is ${driverProfile.driverType}.`,
      );
    }
    if (driverProfile.status === DriverStatus.OFFLINE) {
      // Business call: allow but warn, or block. We block by default.
      throw new BadRequestException('Driver is offline');
    }

    // 4. Atomic transition UNACCEPTED → ORDER_ASSIGNED
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          orderStatus: OrderStatus.UNACCEPTED,
          driverId: null,
        },
        data: {
          orderStatus: OrderStatus.ORDER_ASSIGNED,
          driverId: dto.driverId,
          driverAssignedAt: now,
          assignedByAdminId: adminUserId,
          manuallyAssignedAt: now,
          statusHistory: {
            push: {
              status: OrderStatus.ORDER_ASSIGNED,
              timestamp: now.toISOString(),
              note: 'MANUAL_ADMIN_ASSIGNMENT',
              actorId: adminUserId,
              actorRole: Role.ADMIN,
              reason: dto.reason,
            },
          },
        },
      });
      if (updated.count !== 1) return { ok: false as const };

      // Any stale assignment row that was left PENDING → attach this driver.
      await tx.driverAssignment.updateMany({
        where: { orderId, assignmentStatus: AssignmentStatus.PENDING },
        data: {
          assignmentStatus: AssignmentStatus.ACCEPTED,
          driverId: dto.driverId,
        },
      });

      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'MANUAL_ADMIN_ASSIGNMENT',
          fromStatus: OrderStatus.UNACCEPTED,
          toStatus: OrderStatus.ORDER_ASSIGNED,
          reason: dto.reason ?? null,
          metadata: { driverId: dto.driverId },
        },
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      throw new ConflictException('Order was modified concurrently');
    }

    // 5. Defensive drain of any lingering pending candidates.
    await this.driverAssignment.drainPendingCandidates(orderId);

    // 6. Customer-facing status update
    try {
      const fresh = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { statusHistory: true },
      });
      this.mapGateway.emitOrderStatus(
        orderId,
        OrderStatus.ORDER_ASSIGNED,
        fresh?.statusHistory ?? [],
      );
    } catch (err) {
      this.logger.warn(
        `emitOrderStatus failed for ${orderId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 7. Push to the assigned driver's app
    try {
      const store = order.items[0]?.store;
      await this.driverGateway.emitManualAssignment(dto.driverId, {
        orderId,
        orderNumber: order.orderNumber,
        orderStatus: OrderStatus.ORDER_ASSIGNED,
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        pickupLocation: order.pickupLocation,
        dropoffLocation: order.dropoffLocation,
        createdAt: order.createdAt,
        storeId: store?.id?.toString() ?? '',
        storeName: store?.storeName ?? 'Store',
        storeLogo: (store as any)?.storeLogo ?? '',
        storeLat: store?.latitude ?? null,
        storeLng: store?.longitude ?? null,
        manuallyAssigned: true,
        assignedByName: adminUserId,
      });
    } catch (err) {
      this.logger.warn(
        `emitManualAssignment failed for ${dto.driverId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 8. Push-notification fallback
    await this.notificationQueue
      .add(
        'notify-driver-assigned',
        {
          driverId: dto.driverId,
          orderId,
          orderNumber: order.orderNumber,
          storeName: order.items[0]?.store?.storeName ?? 'Store',
        },
        {
          jobId: `assigned-${orderId}-${dto.driverId}`,
          attempts: 3,
          backoff: 2000,
          removeOnComplete: true,
        },
      )
      .catch((err) =>
        this.logger.warn(`notify-driver-assigned enqueue failed: ${err.message}`),
      );

    this.logger.log(
      `Admin ${adminUserId} manually assigned driver ${dto.driverId} to order ${orderId}`,
    );

    return { success: true, orderId, driverId: dto.driverId };
  }

  // -------------------------------------------------------------------------
  // Admin cancel (UNACCEPTED → CANCELLED)
  // -------------------------------------------------------------------------

  async manualCancel(
    orderId: string,
    adminUserId: string,
    dto: { reason: string },
  ): Promise<{ success: true }> {
    await this.assertAdmin(adminUserId);
    if (!dto?.reason?.trim()) {
      throw new BadRequestException('Cancellation reason is required');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, orderStatus: true, userId: true, orderNumber: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.orderStatus !== OrderStatus.UNACCEPTED) {
      throw new ConflictException(
        `Cannot cancel order in status ${order.orderStatus}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, orderStatus: OrderStatus.UNACCEPTED },
        data: {
          orderStatus: OrderStatus.CANCELLED,
          statusHistory: {
            push: {
              status: OrderStatus.CANCELLED,
              timestamp: new Date().toISOString(),
              note: 'ADMIN_CANCELLED',
              actorId: adminUserId,
              actorRole: Role.ADMIN,
              reason: dto.reason,
            },
          },
        },
      });
      if (updated.count !== 1) return { ok: false as const };

      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'ADMIN_CANCELLED',
          fromStatus: OrderStatus.UNACCEPTED,
          toStatus: OrderStatus.CANCELLED,
          reason: dto.reason,
        },
      });
      return { ok: true as const };
    });

    if (!result.ok) {
      throw new ConflictException('Order was modified concurrently');
    }

    // Here the customer IS told (this is an explicit admin action, not an alert).
    await this.notification.sendOrderCancelled(
      order.userId,
      order.orderNumber,
      dto.reason,
    );

    return { success: true };
  }



}