// import { Processor, WorkerHost } from '@nestjs/bullmq';
// import { Job } from 'bullmq';
// import { PrismaService } from 'src/shared/services/prisma.service';
// import { DriverAssignmentService } from '../driver-assignment.service';

// @Processor('driver-assignment')
// export class DriverAssignmentProcessor extends WorkerHost {
//   constructor(
//     // private driverAssignmentService: DriverService,
//     private driverAssignmentService: DriverAssignmentService,
//     public readonly prisma: PrismaService,
//   ) {
//     super();
//   }

//   async process(job: Job): Promise<any> {
//     switch (job.name) {
//       case 'search-and-notify':
//         return this.driverAssignmentService.findAndNotifyDrivers(
//           job.data.orderId,
//           job.data.vendorLocation,
//         );
//       case 'assignment-timeout':
//         // Handle timeout: if order still pending, escalate
//         const pending = await this.driverAssignmentService.redis.get(
//           job.data.pendingKey,
//         );
//         if (pending) {
//           await this.driverAssignmentService.handleNoDrivers(job.data.orderId);
//         }
//         break;
//       case 'retry-driver-search':
//         // Expand search radius and retry
//         const { orderId, radius } = job.data;
//         const order =
//           await this.driverAssignmentService.prisma.order.findUnique({
//             where: { id: orderId },
//           });
//         const location = order.pickupLocation as any;
//         const drivers = await this.driverAssignmentService.getNearbyDrivers(
//           location.lat,
//           location.lng,
//           radius,
//         );
//         if (drivers.length === 0) {
//           await this.driverAssignmentService.handleNoDrivers(orderId);
//         } else {
//           // Notify again
//           await this.driverAssignmentService.findAndNotifyDrivers(
//             orderId,
//             location,
//           );
//         }
//         break;
//     }
//   }

  
// }
// driver-assignment.processor.ts (existing file, extended)
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from 'src/shared/services/prisma.service';
import { DriverAssignmentService } from '../driver-assignment.service';

@Processor('driver-assignment')
export class DriverAssignmentProcessor extends WorkerHost {
  constructor(
    private driverAssignmentService: DriverAssignmentService,
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
        const pending = await this.driverAssignmentService.redis.get(
          job.data.pendingKey,
        );
        if (pending) {
          await this.driverAssignmentService.handleNoDrivers(job.data.orderId);
        }
        break;
      case 'retry-driver-search':
        const { orderId, radius } = job.data;
        const order = await this.driverAssignmentService.prisma.order.findUnique({
          where: { id: orderId },
        });
        const location = order.pickupLocation as any;
        const drivers = await this.driverAssignmentService.getNearbyDrivers(
          location.lat,
          location.lng,
          radius,
        );
        if (drivers.length === 0) {
          await this.driverAssignmentService.handleNoDrivers(orderId);
        } else {
          await this.driverAssignmentService.findAndNotifyDrivers(orderId, location);
        }
        break;
        case 'driver-response-timeout':
        await this.handleDriverTimeout(job);
        break;

      // NEW: ETA update handler
      case 'update-eta':
        await this.handleEtaUpdate(job);
        break;
    }
  }

  private async handleEtaUpdate(
    job: Job<{ orderId: string; driverId: string; leg: 'to-vendor' | 'to-customer' }>
  ) {
    const { orderId, driverId, leg } = job.data;
    const service = this.driverAssignmentService;

    // Get driver's current location from Redis
    const driverLocStr = await service.redis.get(`driver:${driverId}:loc`);
    if (!driverLocStr) return; // no recent location

    const driverLoc = JSON.parse(driverLocStr);
    let destination: { lat: number; lng: number };

    if (leg === 'to-vendor') {
      const order = await service.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { store: true } } },
      });
      const store = order?.items[0]?.store;
      const pickupLocation = order?.pickupLocation as any;
      destination = {
        lat: store?.latitude ?? pickupLocation?.latitude ?? pickupLocation?.lat,
        lng: store?.longitude ?? pickupLocation?.longitude ?? pickupLocation?.lng,
      };
    } else {
      const order = await service.prisma.order.findUnique({ where: { id: orderId } });
      const dropoff = order?.dropoffLocation as any;
      if (!dropoff?.lat || !dropoff?.lng) return;
      destination = { lat: dropoff.lat, lng: dropoff.lng };
    }

    const { durationSec, polyline } = await service.getRouteDetails(driverLoc, destination);
    await service.mapGateway.emitEta(orderId, durationSec, leg);
    if (polyline) {
      await service.mapGateway.emitPolyline(orderId, polyline, leg);
      await service.redis.setex(`order:${orderId}:polyline`, 3600, polyline);
    }
  }

  private async handleDriverTimeout(
  job: Job<{ orderId: string; driverId: string }>
) {
  const { orderId, driverId } = job.data;
  const service = this.driverAssignmentService;

  // Check if this driver still holds the pending claim
  const pendingDriverId = await service.redis.get(`order:${orderId}:pending`);
  if (pendingDriverId === driverId) {
    // Driver didn't accept – notify them via WebSocket
    service.driverGateway?.emitRequestTimeout(driverId, orderId);

    // Remove the pending key so that other drivers can be notified
    await service.redis.del(`order:${orderId}:pending`);

    // Try the next available driver (if any)
    await service.tryNextDriver(orderId);
  }
}
}