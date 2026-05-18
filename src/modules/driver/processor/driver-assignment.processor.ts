import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DriverService } from '../driver.service';
import { PrismaService } from 'src/shared/services/prisma.service';

@Processor('driver-assignment')
export class DriverAssignmentProcessor extends WorkerHost {
  constructor(
    private driverAssignmentService: DriverService,
    public readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'search-and-notify':
        return this.driverAssignmentService.findAndNotifyDrivers(
          job.data.orderId,
          job.data.vendorLocation,
        );
      case 'assignment-timeout':
        // Handle timeout: if order still pending, escalate
        const pending = await this.driverAssignmentService.redis.get(
          job.data.pendingKey,
        );
        if (pending) {
          await this.driverAssignmentService.handleNoDrivers(job.data.orderId);
        }
        break;
      case 'retry-driver-search':
        // Expand search radius and retry
        const { orderId, radius } = job.data;
        const order =
          await this.driverAssignmentService.prisma.order.findUnique({
            where: { id: orderId },
          });
        const location = JSON.parse(order.pickupLocation);
        const drivers = await this.driverAssignmentService.getNearbyDrivers(
          location.lat,
          location.lng,
          radius,
        );
        if (drivers.length === 0) {
          await this.driverAssignmentService.handleNoDrivers(orderId);
        } else {
          // Notify again
          await this.driverAssignmentService.findAndNotifyDrivers(
            orderId,
            location,
          );
        }
        break;
    }
  }
}
