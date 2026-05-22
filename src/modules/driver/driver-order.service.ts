import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { DriverAssignmentService } from './driver-assignment.service';

@Injectable()
export class DriverOrderService {
  private readonly logger = new Logger(DriverOrderService.name);

  constructor(
    private readonly driverAssignmentService: DriverAssignmentService,
  ) {}

  async acceptOrder(orderId: string, driverId: string): Promise<boolean> {
    return this.driverAssignmentService.driverAccepts(orderId, driverId);
  }

  async confirmPickup(orderId: string, driverId: string) {
    await this.driverAssignmentService.transition(
      orderId,
      OrderStatus.PICKED_UP,
      {
        actorId: driverId,
        actorRole: Role.DISPATCHER,
      },
    );
    // Switch navigation to leg2: vendor → customer
    //await this.mapGateway.switchToCustomerLeg(orderId);
    await this.driverAssignmentService.switchToCustomerLeg(orderId, driverId);
  }
}
