
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/services/prisma.service';
import { DriverAssignmentService } from '../driver-assignment.service';

@Injectable()
export class StaleOrderSweeper {
  private readonly logger = new Logger(StaleOrderSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly driverAssignment: DriverAssignmentService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepStaleAcceptedOrders() {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes

    const staleOrders = await this.prisma.order.findMany({
      where: {
        orderStatus: OrderStatus.ORDER_ACCEPTED,
        createdAt: { lt: cutoff },
      },
      select: { id: true, orderNumber: true },
    });

    if (!staleOrders.length) return;

    this.logger.warn(`Sweeping ${staleOrders.length} stale ACCEPTED orders`);

    for (const order of staleOrders) {
      try {
        // Force trigger the "no drivers" path, which will flip it to UNACCEPTED
        // and email the admins.
        await this.driverAssignment.handleNoDrivers(order.id, 999); 
        this.logger.log(`Swept order ${order.orderNumber} to UNACCEPTED`);
      } catch (err) {
        this.logger.error(
          `Failed to sweep order ${order.orderNumber}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}