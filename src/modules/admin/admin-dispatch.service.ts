
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
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
import { DISPATCH_CONFIG } from '../../shared/utils/constant';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';

@Injectable()
export class AdminDispatchService {
  private readonly logger = new Logger(AdminDispatchService.name);

  private readonly driverResponseTimeoutSeconds =
    DISPATCH_CONFIG.driver.responseTimeoutSeconds;

  private readonly defaultRadiusMeters =
    DISPATCH_CONFIG.retry.defaultRadiusMeters;

  private readonly assignmentTimeoutSeconds =
    DISPATCH_CONFIG.assignment.timeoutSeconds;

  constructor(
    @Inject(REDIS_CLIENT)
    public redis: Redis,
    private readonly prisma: PrismaService,
    private readonly driverAssignment: DriverAssignmentService,
    private readonly driverGateway: DriverGateway,
    private readonly mapGateway: MapGateway,
    private readonly notification: NotificationService,

    @InjectQueue(QUEUES.DRIVER_ASSIGNMENT)
    public assignmentQueue: Queue,
  ) {}


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

  // Idempotency: retried request after a successful manual assign → success, no side effects.
  if (
    order.orderStatus === OrderStatus.ORDER_ACCEPTED &&
    order.manuallyAssignedAt &&
    order.assignedByAdminId === adminUserId &&
    order.driverId === dto.driverId
  ) {
    this.logger.log(`Order ${orderId} already manually assigned to ${dto.driverId}; no-op`);
    return { success: true };
  }

  if (order.orderStatus !== OrderStatus.UNACCEPTED) {
    throw new ConflictException(
      `Order status is ${order.orderStatus}, expected UNACCEPTED`,
    );
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

  const now = new Date();

  // ── 1. Atomic transition: UNACCEPTED → ORDER_ACCEPTED with a PENDING assignment.
  // The order is *reserved* for dto.driverId (order.driverId) but not yet ASSIGNED;
  // the driver still calls /accept, which runs the same transaction as normal dispatch.
  const result = await this.prisma.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, orderStatus: OrderStatus.UNACCEPTED },
        data: {
          orderStatus: OrderStatus.ORDER_ACCEPTED,
          driverId: dto.driverId, // reserve for target driver; used by driverAccepts guard
          driverAssignedAt: null, // set on real accept
          assignedByAdminId: adminUserId,
          manuallyAssignedAt: now,
          dispatchRadiusMeters: this.defaultRadiusMeters,
          statusHistory: {
            push: {
              status: OrderStatus.ORDER_ACCEPTED,
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

      // Reset to a fresh PENDING assignment (find → create/update, no upsert / no ON CONFLICT dependency).
      const existing = await tx.driverAssignment.findUnique({
        where: { orderId },
        select: { id: true },
      });
      if (existing) {
        await tx.driverAssignment.update({
          where: { orderId },
          data: {
            assignmentStatus: AssignmentStatus.PENDING,
            driverId: null,
            assignedAt: null,
            etaSeconds: null,
          },
        });
      } else {
        await tx.driverAssignment.create({
          data: { orderId, assignmentStatus: AssignmentStatus.PENDING },
        });
      }

      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'MANUAL_ADMIN_ASSIGNMENT',
          fromStatus: OrderStatus.UNACCEPTED,
          toStatus: OrderStatus.ORDER_ACCEPTED,
          reason: dto.reason ?? null,
          metadata: { targetDriverId: dto.driverId },
        },
      });

      return { ok: true as const };
    },
    { timeout: 5000, isolationLevel: 'ReadCommitted', maxWait: 2000 },
  );

  if (!result.ok) {
    // Concurrent modification: re-read to give a useful message / honor idempotency.
    const current = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true, driverId: true, manuallyAssignedAt: true, assignedByAdminId: true },
    });
    if (
      current?.orderStatus === OrderStatus.ORDER_ACCEPTED &&
      current.manuallyAssignedAt &&
      current.assignedByAdminId === adminUserId &&
      current.driverId === dto.driverId
    ) {
      return { success: true };
    }
    throw new ConflictException('Order was modified concurrently');
  }

  // ── 2. Seed Redis so the target driver is a *notified* candidate for this order.
  // This is what makes the late-acceptance branch unnecessary and lets /accept
  // follow the normal claim path.
  const TTL_SECONDS = this.driverResponseTimeoutSeconds ?? 300;
  const pendingKey = `order:${orderId}:pending:${dto.driverId}`;

  await this.redis.setex(pendingKey, TTL_SECONDS, 'pending');
  await this.redis.sadd(`driver:${dto.driverId}:pending_claims`, orderId);
  await this.redis.sadd(`order:${orderId}:pending_drivers`, dto.driverId);

  // Per-driver response timeout (rolls back an unaccepted manual assignment).
  await this.assignmentQueue
    .add(
      'driver-response-timeout',
      { orderId, driverId: dto.driverId },
      {
        delay: TTL_SECONDS * 1000,
        jobId: `timeout-${orderId}-${dto.driverId}`,
        removeOnComplete: true,
      },
    )
    .catch(() => null);

  // Global assignment timeout (mirrors initiateDriverSearch).
  await this.assignmentQueue
    .add(
      'assignment-timeout',
      { orderId },
      {
        delay: this.assignmentTimeoutSeconds * 1000,
        jobId: `assignment-timeout-${orderId}`,
        removeOnComplete: true,
      },
    )
    .catch(() => null);

  // Notify any *other* drivers that were pending on this order to drop it.
  // (No-op if this order was never dispatched to anyone else.)
  await this.driverAssignment.drainPendingCandidates(orderId).catch((err) => {
    this.logger.warn(`drainPendingCandidates failed for ${orderId}: ${err}`);
  });

  // ── 3. Notify map + target driver.
  try {
    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { statusHistory: true },
    });
    this.mapGateway.emitOrderStatus(
      orderId,
      OrderStatus.ORDER_ACCEPTED,
      fresh?.statusHistory ?? [],
    );

    const store = order.items[0]?.store;
    await this.driverGateway.emitManualAssignment(dto.driverId, {
      orderId,
      orderNumber: order.orderNumber,
      orderStatus: OrderStatus.ORDER_ACCEPTED, // driver still must accept
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
      //requiresAcceptance: true, // app must show Accept button
    });
  } catch (err) {
    this.logger.warn(`Broadcast failed for ${orderId}: ${err}`);
  }

  return { success: true };
}

  async manualAssignbk(
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
    throw new ConflictException(
      `Order status is ${order.orderStatus}, expected UNACCEPTED`,
    );
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

  const now = new Date();

  // ── 1. Atomic transition: UNACCEPTED → ORDER_ACCEPTED, create PENDING assignment
  const result = await this.prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, orderStatus: OrderStatus.UNACCEPTED },
      data: {
        orderStatus: OrderStatus.ORDER_ACCEPTED,
        driverAssignedAt: null,          // will be set on driver accept
        driverId: null,                  // will be set on driver accept
        assignedByAdminId: adminUserId,
        manuallyAssignedAt: now,
        dispatchRadiusMeters: this.defaultRadiusMeters,
        statusHistory: {
          push: {
            status: OrderStatus.ORDER_ACCEPTED,
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

    // Reset/create a PENDING assignment — same shape the normal flow produces
    await tx.driverAssignment.upsert({
      where: { orderId },
      update: {
        assignmentStatus: AssignmentStatus.PENDING,
        driverId: null,
        assignedAt: null,
        etaSeconds: null,
      },
      create: {
        orderId,
        assignmentStatus: AssignmentStatus.PENDING,
      },
    });

    await tx.orderActivityLog.create({
      data: {
        orderId,
        actorId: adminUserId,
        actorRole: Role.ADMIN,
        action: 'MANUAL_ADMIN_ASSIGNMENT',
        fromStatus: OrderStatus.UNACCEPTED,
        toStatus: OrderStatus.ORDER_ACCEPTED,
        reason: dto.reason ?? null,
        metadata: { targetDriverId: dto.driverId },
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) throw new ConflictException('Order was modified concurrently');

  // ── 2. Seed Redis so this driver is a *notified* candidate (fixes late-accept branch)
  const pendingKey = `order:${orderId}:pending:${dto.driverId}`;
  const TTL = this.driverResponseTimeoutSeconds ?? 300;

  await this.redis.setex(pendingKey, TTL, 'pending');
  await this.redis.sadd(`driver:${dto.driverId}:pending_claims`, orderId);
  await this.redis.sadd(`order:${orderId}:pending_drivers`, dto.driverId);

  // Schedule the per-driver response timeout (so unaccepted manual assignments roll back)
  await this.assignmentQueue
    .add(
      'driver-response-timeout',
      { orderId, driverId: dto.driverId },
      {
        delay: TTL * 1000,
        jobId: `timeout-${orderId}-${dto.driverId}`,
        removeOnComplete: true,
      },
    )
    .catch(() => null);

  // Schedule the global assignment timeout too (matches initiateDriverSearch behavior)
  await this.assignmentQueue
    .add(
      'assignment-timeout',
      { orderId },
      {
        delay: this.assignmentTimeoutSeconds * 1000,
        jobId: `assignment-timeout-${orderId}`,
        removeOnComplete: true,
      },
    )
    .catch(() => null);

  // ── 3. Notify map + driver
  try {
    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { statusHistory: true },
    });
    this.mapGateway.emitOrderStatus(
      orderId,
      OrderStatus.ORDER_ACCEPTED,
      fresh?.statusHistory ?? [],
    );

    const store = order.items[0]?.store;
    await this.driverGateway.emitManualAssignment(dto.driverId, {
      orderId,
      orderNumber: order.orderNumber,
      orderStatus: OrderStatus.ORDER_ACCEPTED, // driver still must accept
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
      // hint the client this needs an explicit accept
      //requiresAcceptance: true,
    });
  } catch (err) {
    this.logger.warn(`Broadcast failed for ${orderId}: ${err}`);
  }

  return { success: true };
}

  async manualAssignold(
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

      const assigned = await tx.driverAssignment.updateMany({
        where: { orderId, assignmentStatus: AssignmentStatus.PENDING },
        data: { assignmentStatus: AssignmentStatus.ACCEPTED, driverId: dto.driverId },
      });

      if (assigned.count === 0) {
        // No pending assignment to claim — the order was already in-flight.
        // (Shouldn't happen if orderStatus guard passed, but be safe.)
        throw new ConflictException('No pending assignment to claim');
      }

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
        { user: { lastName: { contains: params.search, mode: 'insensitive' } } },
        { user: { email: { contains: params.search, mode: 'insensitive' } } },
        { user: { phoneNumber: { contains: params.search, mode: 'insensitive' } } },
        { licensePlate: { contains: params.search, mode: 'insensitive' } },
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