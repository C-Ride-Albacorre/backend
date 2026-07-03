
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from 'src/shared/services/prisma.service';
import { DriverAssignmentService } from '../driver-assignment.service';

@Processor('driver-assignment')
export class DriverAssignmentProcessor extends WorkerHost {
 p
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

  // private async handleEtaUpdate(
  //   job: Job<{ orderId: string; driverId: string; leg: 'to-vendor' | 'to-customer' }>
  // ) {
 
  //   //////
  //   let { orderId, driverId, leg } = job.data;
  //   const service = this.driverAssignmentService;

  //   ////////

  // // 1. Read the current leg from Redis (or fallback to job.data.leg)
  // const legKey = `order:${orderId}:leg`;
  // const legFromRedis = await service.redis.get(legKey);
  // leg = legFromRedis as 'to-vendor' | 'to-customer' || job.data.leg;

  // if (!leg) {
  //   console.log(`No leg found for order ${orderId}, skipping ETA update`);
  //   return;
  // }

  //   // Get driver's current location from Redis
  //   const driverLocStr = await service.redis.get(`driver:${driverId}:loc`);
  //   if (!driverLocStr) return; // no recent location

  //   const driverLoc = JSON.parse(driverLocStr);
  //   let destination: { lat: number; lng: number };

  //   if (leg === 'to-vendor') {
  //     const order = await service.prisma.order.findUnique({
  //       where: { id: orderId },
  //       include: { items: { include: { store: true } } },
  //     });
  //     const store = order?.items[0]?.store;
  //     const pickupLocation = order?.pickupLocation as any;
  //     destination = {
  //       lat: store?.latitude ?? pickupLocation?.latitude ?? pickupLocation?.lat,
  //       lng: store?.longitude ?? pickupLocation?.longitude ?? pickupLocation?.lng,
  //     };
  //   } else {
  //     const order = await service.prisma.order.findUnique({ where: { id: orderId } });
  //     const dropoff = order?.dropoffLocation as any;
  //     if (!dropoff?.lat || !dropoff?.lng) return;
  //     destination = { lat: dropoff.lat, lng: dropoff.lng };
  //   }

  //   const { durationSec, polyline } = await service.getRouteDetails(driverLoc, destination);
  //   await service.mapGateway.emitEta(orderId, durationSec, leg);
  //   if (polyline) {
  //     await service.mapGateway.emitPolyline(orderId, polyline, leg);
  //     await service.redis.setex(`order:${orderId}:polyline`, 3600, polyline);
  //   }
  // }

  private async handleEtaUpdate(
  job: Job<{ orderId: string; driverId: string; leg: 'to-vendor' | 'to-customer' }>
) {
  let { orderId, driverId, leg } = job.data;
  const service = this.driverAssignmentService;

  // 1. Read the current leg from Redis (or fallback to job.data.leg)
  const legKey = `order:${orderId}:leg`;
  const legFromRedis = await service.redis.get(legKey);
  leg = (legFromRedis as 'to-vendor' | 'to-customer') || job.data.leg;

  if (!leg) {
    service.logger.warn(`No leg found for order ${orderId}, skipping ETA update`);
    return;
  }

  // 2. Get driver's current location from Redis
  const driverLocStr = await service.redis.get(`driver:${driverId}:loc`);
  if (!driverLocStr) {
    service.logger.debug(`No location for driver ${driverId}, skipping ETA update`);
    return;
  }

  const driverLoc = JSON.parse(driverLocStr);
  let destination: { lat: number; lng: number };

  // 3. Determine destination based on leg
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
    // to-customer
    const order = await service.prisma.order.findUnique({
      where: { id: orderId },
      select: { dropoffLocation: true },
    });
    const dropoff = order?.dropoffLocation as any;
    // ✅ Use the correct field names (latitude/longitude)
    const lat = dropoff?.latitude ?? dropoff?.lat;
    const lng = dropoff?.longitude ?? dropoff?.lng;
    if (!lat || !lng) {
      service.logger.warn(`Order ${orderId} has no valid dropoff location`);
      return;
    }
    destination = { lat, lng };
  }

  // 4. Calculate route and emit
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