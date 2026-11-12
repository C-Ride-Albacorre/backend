import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, OrderStatus, Role } from '@prisma/client';
import { DriverAssignmentService } from './driver-assignment.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { OrderService } from '../order/order.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from '../../shared/constants';

@Injectable()
export class DriverOrderService {
  private readonly logger = new Logger(DriverOrderService.name);

  constructor(
    private readonly driverAssignmentService: DriverAssignmentService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrderService))
    private orderService: OrderService,
    @InjectQueue(QUEUES.CUSTOMER_NOTIFICATION)
    private customerNotificationQueue: Queue,

    @InjectQueue(QUEUES.VENDOR_NOTIFICATION)
    private vendorNotificationQueue: Queue,
  ) { }

  async acceptOrder(orderId: string, driverId: string): Promise<boolean> {
    return this.driverAssignmentService.driverAccepts(orderId, driverId);
  }

  
async confirmPickup(
  orderId: string,
  driverId: string,
): Promise<void> {
  // 1. Verify driver is assigned to this order
  const assignment = await this.prisma.driverAssignment.findUnique({
    where: { orderId },
    select: {
      driverId: true,
      assignmentStatus: true,
    },
  });

  if (!assignment || assignment.driverId !== driverId) {
    throw new Error(
      `Driver ${driverId} is not assigned to order ${orderId}`,
    );
  }

  if (assignment.assignmentStatus !== AssignmentStatus.ASSIGNED) {
    throw new Error(
      `Order ${orderId} is not in ASSIGNED state (current: ${assignment.assignmentStatus})`,
    );
  }

  // 2. Set up navigation before changing order status
  try {
    await this.driverAssignmentService.switchToCustomerLeg(
      orderId,
      driverId,
    );
  } catch (error) {
    this.logger.error(
      `Failed to switch to customer leg for order ${orderId}`,
      error,
    );

    throw new Error(`Navigation setup failed: ${error}`);
  }

  // 3. Transition order status
  await this.orderService.transition(
    orderId,
    OrderStatus.PICKED_UP,
    {
      actorId: driverId,
      actorRole: Role.DISPATCHER,
      respondedAt: new Date(),
    },
  );

  // 4. Fetch order details for notifications
  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      items: {
        select: {
          store: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    this.logger.warn(
      `Order ${orderId} not found after pickup confirmation`,
    );
    return;
  }

  // 5. Queue customer notification
  await this.customerNotificationQueue.add(
    'order-picked-up',
    {
      orderId,
      driverId,
    },
    {
      jobId: `customer-order-picked-up-${orderId}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: true,
    },
  );

  // 6. Queue vendor notifications
  const storeIds = [
    ...new Set(
      order.items
        .map((item) => item.store?.id)
        .filter((id): id is string => !!id),
    ),
  ];

  for (const storeId of storeIds) {
    await this.vendorNotificationQueue.add(
      'order-picked-up',
      {
        orderId,
        driverId,
        storeId,
      },
      {
        jobId: `vendor-order-picked-up-${orderId}-${storeId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: true,
      },
    );
  }

  this.logger.log(
    `Driver ${driverId} confirmed pickup for order ${orderId}. Notification jobs queued.`,
  );
}


  async confirmPickupOld(orderId: string, driverId: string): Promise<void> {
    // 1. Verify driver is assigned to this order (idempotency + security)
    const assignment = await this.prisma.driverAssignment.findUnique({
      where: { orderId },
      select: { driverId: true, assignmentStatus: true },
    });

    if (!assignment || assignment.driverId !== driverId) {
      throw new Error(`Driver ${driverId} is not assigned to order ${orderId}`);
    }

    if (assignment.assignmentStatus !== AssignmentStatus.ASSIGNED) {
      throw new Error(`Order ${orderId} is not in ASSIGNED state (current: ${assignment.assignmentStatus})`);
    }

    // 2. Set up navigation BEFORE changing order status (to avoid inconsistency)
    try {
      await this.driverAssignmentService.switchToCustomerLeg(orderId, driverId);
    } catch (error) {
      this.logger.error(`Failed to switch to customer leg for order ${orderId}`, error);
      throw new Error(`Navigation setup failed: ${error}`);
    }

    // 3. Transition order status (idempotent – if already PICKED_UP, Prisma will throw)
    await this.orderService.transition(orderId, OrderStatus.PICKED_UP, {
      actorId: driverId,
      actorRole: Role.DISPATCHER,
      respondedAt: new Date()
    });

    this.logger.log(`Driver ${driverId} confirmed pickup for order ${orderId}`);
  }

}
