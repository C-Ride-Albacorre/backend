
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from 'src/shared/services/prisma.service';
import { DriverAssignmentService } from '../driver-assignment.service';
import Helper from '../../../shared/utils/helpers';
import { PushNotificationService } from '../../../modules/notification/push-notification.service';

@Processor('driver-assignment')
export class DriverAssignmentProcessor extends WorkerHost {

  constructor(
    private driverAssignmentService: DriverAssignmentService,
    public readonly prisma: PrismaService,
    @InjectQueue('driver-assignment') public assignmentQueue: Queue,
    private pushNotificationService: PushNotificationService,
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
  //   service.logger.warn(`No leg found for order ${orderId}, skipping ETA update`);
  //   return;
  // }

  //   // Get driver's current location from Redis
  //   const driverLocStr = await service.redis.get(`driver:${driverId}:loc`);
  //  // if (!driverLocStr) return; // no recent location
  //   if (!driverLocStr) {
  //     service.logger.debug(`No location for driver ${driverId}, skipping ETA update`);
  //     return;
  //   }

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
  //     // to-customer
  //     const order = await service.prisma.order.findUnique({ where: { id: orderId } });
  //     const dropoff = order?.dropoffLocation as any;
  //     if (!dropoff?.lat || !dropoff?.lng) return;
  //     service.logger.log(`Order ${orderId} dropoff location: ${JSON.stringify(dropoff)}`);
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
    service.logger.log(`🔄 ETA job running for order ${orderId}, leg: ${leg}`);

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
        include: { items: { include: { store: true }, } },
      });
      if (!order) {
        // Order no longer exists – clean up the job scheduler
        service.logger.debug(`Order ${orderId} not found, removing ETA scheduler`);
        await this.assignmentQueue.removeJobScheduler(`eta-${orderId}`).catch(() => null);
        return;
      }
      // Check if order is in a terminal state
      if (['DELIVERED', 'CANCELLED'].includes(order.orderStatus)) {
        service.logger.debug(`Order ${orderId} is ${order.orderStatus}, removing ETA scheduler`);
        await this.assignmentQueue.removeJobScheduler(`eta-${orderId}`).catch(() => null);
        return;
      }
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
        select: { dropoffLocation: true, orderStatus: true },
      });
      if (!order) {
        service.logger.debug(`Order ${orderId} not found, removing ETA scheduler`);
        await this.assignmentQueue.removeJobScheduler(`eta-${orderId}`).catch(() => null);
        return;
      }
      if (['DELIVERED', 'CANCELLED'].includes(order.orderStatus)) {
        service.logger.debug(`Order ${orderId} is ${order.orderStatus}, removing ETA scheduler`);
        await this.assignmentQueue.removeJobScheduler(`eta-${orderId}`).catch(() => null);
        return;
      }
      const dropoff = order?.dropoffLocation as any;
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

    // 5. ARRIVAL DETECTION
    const distance = Helper.calculateDistance(driverLoc, destination); // in meters
    const ARRIVAL_THRESHOLD = 50; // meters

    if (distance <= ARRIVAL_THRESHOLD) {
      const arrivedKey = `order:${orderId}:arrived:${leg}`;
      const alreadyArrived = await service.redis.get(arrivedKey);
      service.logger.log(`Driver ${driverId} is within ${distance.toFixed(2)}m of destination for order ${orderId}, leg: ${leg}`);
      if (!alreadyArrived) {
        // Mark as arrived (TTL 1 hour)
        await service.redis.setex(arrivedKey, 3600, 'true');

        // Emit arrival event
        await service.mapGateway.emitDriverArrived(orderId, leg);

        // Stop the recurring ETA job (no need to keep updating)
        await service.assignmentQueue.removeJobScheduler(`eta-${orderId}`).catch(() => null);
        service.logger.log(`✅ Driver arrived at ${leg} for order ${orderId}`);

        // ----- PUSH NOTIFICATION -----
        // Get the customer's device token from the order object (already fetched)
        // 13. PUSH NOTIFICATION
        //
        // IMPORTANT:
        // sendToUser() expects the CUSTOMER USER ID,
        // NOT an FCM token.
        //
        // Assuming your Order model has customerId:

        const customerId = await service.prisma.order.findUnique({
          where: { id: orderId },
          select: { userId: true },
        }).then(order => order?.userId);

        if (!customerId) {
          service.logger.warn(
            `No customerId found for order ${orderId}; cannot send arrival push`,
          );
          return;
        }

        const title =
          leg === 'to-vendor'
            ? 'Driver arrived at the store'
            : 'Driver arrived at your location';

        const body =
          leg === 'to-vendor'
            ? 'Your driver has arrived at the vendor and is picking up your order.'
            : 'Your order has arrived! Please collect your delivery.';

        const pushSent =
          await this.pushNotificationService.sendToUser(
            customerId,
            {
              title,
              body,
              data: {
                orderId: String(orderId),
                leg: String(leg),
                type: 'DRIVER_ARRIVED',
              },
              priority: 'high',
            },
          );

        if (pushSent) {
          service.logger.log(
            `📲 Arrival push sent to customer ${customerId} for order ${orderId}`,
          );
        } else {
          service.logger.warn(
            `⚠️ Arrival push could not be sent to customer ${customerId} for order ${orderId}`,
          );
        }

        // ----- END PUSH -----

        service.logger.log(`✅ Driver arrived at ${leg} for order ${orderId}`);
      }
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