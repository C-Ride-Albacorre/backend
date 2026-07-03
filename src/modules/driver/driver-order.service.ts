import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, OrderStatus, Role } from '@prisma/client';
import { DriverAssignmentService } from './driver-assignment.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { OrderService } from '../order/order.service';

@Injectable()
export class DriverOrderService {
  private readonly logger = new Logger(DriverOrderService.name);

  constructor(
    private readonly driverAssignmentService: DriverAssignmentService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrderService))
    private orderService: OrderService, 
  ) {}

  async acceptOrder(orderId: string, driverId: string): Promise<boolean> {
    return this.driverAssignmentService.driverAccepts(orderId, driverId);
  }

  async confirmPickup(orderId: string, driverId: string): Promise<void> {
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
  // await this.driverAssignmentService.transition(orderId, OrderStatus.PICKED_UP, {
  await this.orderService.transition(orderId, OrderStatus.PICKED_UP, {
    actorId: driverId,
    actorRole: Role.DISPATCHER, 
    respondedAt: new Date()
  });

  this.logger.log(`Driver ${driverId} confirmed pickup for order ${orderId}`);
}

  async confirmPickupOld(orderId: string, driverId: string) {
    // await this.driverAssignmentService.transition(
    await this.orderService.transition(
      orderId,
      OrderStatus.PICKED_UP,
      {
        actorId: driverId,
        actorRole: Role.DISPATCHER,
        respondedAt: new Date()
      },
    );
    // Switch navigation to leg2: vendor → customer
    //await this.mapGateway.switchToCustomerLeg(orderId);
    await this.driverAssignmentService.switchToCustomerLeg(orderId, driverId);
  }
}
