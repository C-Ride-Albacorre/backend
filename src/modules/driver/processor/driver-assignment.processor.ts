
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from 'src/shared/services/prisma.service';
import { DriverAssignmentService } from '../driver-assignment.service';
import Helper from '../../../shared/utils/helpers';
import { PushNotificationService } from '../../../modules/notification/push-notification.service';
import { OrderStatus } from '@prisma/client';

@Processor('driver-assignment')
export class DriverAssignmentProcessor extends WorkerHost {
  private readonly logger = new Logger(DriverAssignmentProcessor.name);

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
      case 'assignment-timeout': {
        const { orderId } = job.data;
        const service = this.driverAssignmentService;

        // DB is authoritative – check current order status
        const order = await service.prisma.order.findUnique({
          where: { id: orderId },
          select: { orderStatus: true },
        });

        // If order no longer exists or is not ACCEPTED, the assignment is already resolved
        if (!order || order.orderStatus !== OrderStatus.ORDER_ACCEPTED) {
          this.logger.debug(
            `Global timeout for order ${orderId} ignored – order status is ${order?.orderStatus ?? 'unknown'}`
          );
          return;
        }

        // Order is still ACCEPTED – no driver has accepted within the global window
        this.logger.warn(`No driver accepted order ${orderId} within global timeout – escalating`);
        await service.handleNoDrivers(orderId);
        break;
      }
      // case 'assignment-timeout':
      //   const pending = await this.driverAssignmentService.redis.get(
      //     job.data.pendingKey,
      //   );
      //   if (pending) {
      //     await this.driverAssignmentService.handleNoDrivers(job.data.orderId);
      //   }
      //   break;
      case 'retry-driver-search': {
        const { orderId, radius, attempt } = job.data;
        await this.driverAssignmentService.tryNextDriver(orderId, radius, attempt);
        break;
      }
      // case 'retry-driver-search':
      //   const { orderId, radius } = job.data;
      //   const order = await this.driverAssignmentService.prisma.order.findUnique({
      //     where: { id: orderId },
      //   });
      //   const location = order.pickupLocation as any;
      //   const drivers = await this.driverAssignmentService.getNearbyDrivers(
      //     location.lat,
      //     location.lng,
      //     radius,
      //   );
      //   if (drivers.length === 0) {
      //     await this.driverAssignmentService.handleNoDrivers(orderId);
      //   } else {

      //     await this.driverAssignmentService.findAndNotifyDrivers(orderId, location);
      //   }
      //   break;
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
  const { orderId, driverId, leg: jobLeg } = job.data;
  const service = this.driverAssignmentService;
  const schedulerName = `eta-${orderId}`;
  const guardKey = `order:${orderId}:eta_stopped`;

  // ------------------------------------------------------------------
  // 1. EARLY TERMINATION CHECKS (ORDER STATUS + ASSIGNMENT STATUS)
  // ------------------------------------------------------------------

  // Redis guard – prevents any processing even if scheduler removal fails
  const stopped = await service.redis.get(guardKey);
  if (stopped) {
    service.logger.debug(`⏹️ ETA updates for order ${orderId} are stopped (Redis flag)`);
    return;
  }

  // Fetch minimal order info + assignment status in parallel
  const [order, assignment] = await Promise.all([
    service.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true, userId: true },
    }),
    service.prisma.driverAssignment.findFirst({
      where: { orderId, driverId },
      select: { assignmentStatus: true }, // correct field name (not 'status')
    }),
  ]);

  // --- Order checks ---
  if (!order) {
    service.logger.debug(`❌ Order ${orderId} not found – removing scheduler and setting guard`);
    await this.removeEtaScheduler(schedulerName);
    await service.redis.setex(guardKey, 86400, 'true');
    return;
  }

  const terminalStatuses = ['DELIVERED', 'CANCELLED', 'COMPLETED'];
  if (terminalStatuses.includes(order.orderStatus)) {
    service.logger.debug(`⏹️ Order ${orderId} is ${order.orderStatus} – removing scheduler and setting guard`);
    await this.removeEtaScheduler(schedulerName);
    await service.redis.setex(guardKey, 86400, 'true');
    return;
  }

  // --- Assignment status check ---
  if (assignment?.assignmentStatus === 'EXPIRED') {
    service.logger.debug(`⏹️ Assignment for order ${orderId} is EXPIRED – removing scheduler and setting guard`);
    await this.removeEtaScheduler(schedulerName);
    await service.redis.setex(guardKey, 86400, 'true');
    return;
  }

  // ------------------------------------------------------------------
  // 2. NORMAL PROCESSING (LEG, LOCATION, ROUTE, ARRIVAL)
  // ------------------------------------------------------------------

  service.logger.log(`🔄 ETA job running for order ${orderId}, leg: ${jobLeg}`);

  // Read current leg from Redis (fallback to job.data.leg)
  const legKey = `order:${orderId}:leg`;
  const legFromRedis = await service.redis.get(legKey);
  const leg = (legFromRedis as 'to-vendor' | 'to-customer') || jobLeg;

  if (!leg) {
    service.logger.warn(`⚠️ No leg found for order ${orderId}, skipping ETA update`);
    return;
  }

  // Get driver's current location from Redis
  const driverLocStr = await service.redis.get(`driver:${driverId}:loc`);
  if (!driverLocStr) {
    service.logger.debug(`📍 No location for driver ${driverId}, skipping ETA update`);
    return;
  }
  const driverLoc = JSON.parse(driverLocStr);

  let destination: { lat: number; lng: number };

  // Determine destination based on leg
  if (leg === 'to-vendor') {
    // For vendor leg we need full order with items & store
    const fullOrder = await service.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { store: true } } },
    });
    if (!fullOrder) {
      service.logger.debug(`❌ Order ${orderId} not found (during vendor leg) – cleaning up`);
      await this.removeEtaScheduler(schedulerName);
      await service.redis.setex(guardKey, 86400, 'true');
      return;
    }
    // Extra safety: status might have changed since the top check (race)
    if (terminalStatuses.includes(fullOrder.orderStatus)) {
      service.logger.debug(`⏹️ Order ${orderId} became ${fullOrder.orderStatus} – cleaning up`);
      await this.removeEtaScheduler(schedulerName);
      await service.redis.setex(guardKey, 86400, 'true');
      return;
    }
    const store = fullOrder?.items[0]?.store;
    const pickupLocation = fullOrder?.pickupLocation as any;
    destination = {
      lat: store?.latitude ?? pickupLocation?.latitude ?? pickupLocation?.lat,
      lng: store?.longitude ?? pickupLocation?.longitude ?? pickupLocation?.lng,
    };
  } else {
    // to-customer leg – only need dropoff location
    const dropoffOrder = await service.prisma.order.findUnique({
      where: { id: orderId },
      select: { dropoffLocation: true, orderStatus: true },
    });
    if (!dropoffOrder) {
      service.logger.debug(`❌ Order ${orderId} not found (during customer leg) – cleaning up`);
      await this.removeEtaScheduler(schedulerName);
      await service.redis.setex(guardKey, 86400, 'true');
      return;
    }
    if (terminalStatuses.includes(dropoffOrder.orderStatus)) {
      service.logger.debug(`⏹️ Order ${orderId} became ${dropoffOrder.orderStatus} – cleaning up`);
      await this.removeEtaScheduler(schedulerName);
      await service.redis.setex(guardKey, 86400, 'true');
      return;
    }
    const dropoff = dropoffOrder?.dropoffLocation as any;
    const lat = dropoff?.latitude ?? dropoff?.lat;
    const lng = dropoff?.longitude ?? dropoff?.lng;
    if (!lat || !lng) {
      service.logger.warn(`⚠️ Order ${orderId} has no valid dropoff location`);
      return;
    }
    destination = { lat, lng };
  }

  // Calculate route and emit ETA + polyline
  const { durationSec, polyline } = await service.getRouteDetails(driverLoc, destination);
  await service.mapGateway.emitEta(orderId, durationSec, leg);
  if (polyline) {
    await service.mapGateway.emitPolyline(orderId, polyline, leg);
    await service.redis.setex(`order:${orderId}:polyline`, 3600, polyline);
  }

  // ------------------------------------------------------------------
  // 3. ARRIVAL DETECTION
  // ------------------------------------------------------------------
  const distance = Helper.calculateDistance(driverLoc, destination); // meters
  const ARRIVAL_THRESHOLD = 50;

  if (distance <= ARRIVAL_THRESHOLD) {
    const arrivedKey = `order:${orderId}:arrived:${leg}`;
    const alreadyArrived = await service.redis.get(arrivedKey);
    service.logger.log(`🚗 Driver ${driverId} is within ${distance.toFixed(2)}m of destination for order ${orderId}, leg: ${leg}`);
    if (!alreadyArrived) {
      // Mark as arrived (TTL 1 hour)
      await service.redis.setex(arrivedKey, 3600, 'true');

      // Emit arrival event
      await service.mapGateway.emitDriverArrived(orderId, leg);

      // Stop the recurring ETA job (no need to keep updating)
      await this.removeEtaScheduler(schedulerName);
      await service.redis.setex(guardKey, 86400, 'true'); // also set guard
      service.logger.log(`✅ Driver arrived at ${leg} for order ${orderId} – scheduler stopped`);

      // ----- PUSH NOTIFICATION -----
      const customerId = order.userId; // already fetched at top
      if (!customerId) {
        service.logger.warn(`⚠️ No customerId found for order ${orderId}; cannot send arrival push`);
        return;
      }

      const title = leg === 'to-vendor'
        ? 'Driver arrived at the store'
        : 'Driver arrived at your location';

      const body = leg === 'to-vendor'
        ? 'Your driver has arrived at the vendor and is picking up your order.'
        : 'Your order has arrived! Please collect your delivery.';

      const pushSent = await this.pushNotificationService.sendToUser(
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
        }
      );

      if (pushSent) {
        service.logger.log(`📲 Arrival push sent to customer ${customerId} for order ${orderId}`);
      } else {
        service.logger.warn(`⚠️ Arrival push could not be sent to customer ${customerId} for order ${orderId}`);
      }
    }
  }
}

/**
 * Attempts to remove the ETA job scheduler.
 * Also tries to clean up repeatable jobs as a fallback.
 */
private async removeEtaScheduler(schedulerName: string): Promise<boolean> {
  try {
    // 1. Try to remove as a Job Scheduler (BullMQ v4+)
    const removed = await this.assignmentQueue.removeJobScheduler(schedulerName);
    if (removed) {
      this.driverAssignmentService.logger.log(`✅ Scheduler ${schedulerName} removed via removeJobScheduler`);
      return true;
    }
  } catch (e) {
    this.driverAssignmentService.logger.warn(`⚠️ removeJobScheduler failed for ${schedulerName}: ${e.message}`);
  }

  // 2. Fallback: try to remove as a repeatable job (if it was created with .add() + repeat)
  try {
    // We need to know the repeat pattern – if you always use a fixed interval (e.g., 5000ms),
    // you must pass the exact same options. We'll try a common pattern.
    // Better: iterate all repeatable jobs and match by name.
    const repeatables = await this.assignmentQueue.getRepeatableJobs();
    const toRemove = repeatables.find(r => r.name === 'eta' && r.id === schedulerName);
    if (toRemove) {
      const removed = await this.assignmentQueue.removeRepeatableByKey(toRemove.key);
      if (removed) {
        this.driverAssignmentService.logger.log(`✅ Scheduler ${schedulerName} removed via removeRepeatable`);
        return true;
      }
    }
  } catch (e) {
    this.driverAssignmentService.logger.warn(`⚠️ removeRepeatable fallback failed for ${schedulerName}: ${e.message}`);
  }

  this.driverAssignmentService.logger.warn(`❌ Could not remove scheduler/repeatable job for ${schedulerName}`);
  return false;
}


  private async handleEtaUpdatebk(
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

  private async handleDriverTimeout(job: Job<{ orderId: string; driverId: string }>) {
    const { orderId, driverId } = job.data;
    const service = this.driverAssignmentService;

    const pendingKey = `order:${orderId}:pending:${driverId}`;
    const driverPendingSet = `driver:${driverId}:pending_claims`;

    // Atomic claim
    const claimed = await service.redis.del(pendingKey);
    if (!claimed) {
      this.logger.debug(`Timeout for driver ${driverId}, order ${orderId} ignored – key already claimed`);
      return;
    }

    await service.redis.srem(driverPendingSet, orderId);

    // DB check before proceeding
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true },
    });
    if (!order || order.orderStatus !== OrderStatus.ORDER_ACCEPTED) {
      this.logger.debug(`Order ${orderId} is no longer ACCEPTED; not notifying next driver`);
      return;
    }

    service.driverGateway?.emitRequestTimeout(driverId, orderId);
    await service.tryNextDriver(orderId);
  }

  private async handleDriverTimeoutOld(
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