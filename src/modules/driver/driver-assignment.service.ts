import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaService } from '../../shared/services/prisma.service';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';
import { OrderStatus, AssignmentStatus, DriverStatus } from '@prisma/client';
import { NotificationType, Role } from '@prisma/client';
import axios from 'axios';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { VendorNotificationGateway } from 'src/common/map-gateway/vendor-notification.gateway';
import { MapGateway } from 'src/common/map-gateway/map.gateway';
import { PushNotificationService } from '../notification/push-notification.service';
import { MessageBody, SubscribeMessage } from '@nestjs/websockets';

type TransitionContext = {
  actorId?: string;
  actorRole?: Role;
  reason?: string;
  metadata?: any;
};

export enum DriverDocumentType {
  DRIVER_LICENSE = 'DRIVER_LICENSE',
  VEHICLE_INSURANCE = 'VEHICLE_INSURANCE',
  VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION',
}

type NearbyDriver = {
  userId: string;
  lat: number;
  lng: number;
};

const CLAIM_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('SETNX', KEYS[2], ARGV[1]) == 1 then
    redis.call('DEL', KEYS[1])
    return 1
  else
    return 0
  end
`;

@Injectable()
export class DriverAssignmentService {
  private readonly logger = new Logger(DriverAssignmentService.name);
  private readonly googleMapsApiKey: string;

  constructor(
    public prisma: PrismaService,
    @Inject(REDIS_CLIENT) public redis: Redis,
    @InjectQueue('driver-notification') private notificationQueue: Queue,
    @InjectQueue('driver-assignment') private assignmentQueue: Queue,
    @InjectQueue('order-events') private orderQueue: Queue,
    private zohoEmailProvider: ZohoEmailProvider,
    private vendorNotificationGateway: VendorNotificationGateway,
    public mapGateway: MapGateway,
    private pushService: PushNotificationService,
  ) { }

  transitions: Record<
    string,
    { from: OrderStatus[]; to: OrderStatus; action: string }
  > = {
      confirm_payment: {
        from: [OrderStatus.ORDER_PLACED], // after payment verification
        to: OrderStatus.ORDER_PLACED,
        action: 'ORDER_PLACED',
      },
      vendor_accept: {
        from: [OrderStatus.ORDER_PLACED],
        to: OrderStatus.ORDER_ACCEPTED,
        action: 'VENDOR_ACCEPT',
      },
      assign_driver: {
        from: [OrderStatus.ORDER_ACCEPTED],
        to: OrderStatus.ORDER_ASSIGNED,
        action: 'ASSIGN_DRIVER',
      },
      pickup: {
        from: [OrderStatus.ORDER_ASSIGNED],
        to: OrderStatus.PICKED_UP,
        action: 'PICKUP',
      },
      deliver: {
        from: [OrderStatus.PICKED_UP],
        to: OrderStatus.DELIVERED,
        action: 'DELIVER',
      },
      cancel: {
        from: [OrderStatus.ORDER_PLACED, OrderStatus.ORDER_ACCEPTED],
        to: OrderStatus.CANCELLED,
        action: 'CANCEL',
      },
    };

  async transition(
    orderId: string,
    targetStatus: OrderStatus,
    context: TransitionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { driverAssignment: true }, //vendorAction: true,
      });
      if (!order) throw new Error('Order not found');

      const current = order.orderStatus;
      const transitionKey = Object.keys(this.transitions).find(
        (key) =>
          this.transitions[key].to === targetStatus &&
          this.transitions[key].from.includes(current),
      );
      if (!transitionKey) {
        throw new BadRequestException(
          `Invalid transition from ${current} to ${targetStatus}`,
        );
      }
      const rule = this.transitions[transitionKey];

      // Update order
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          orderStatus: targetStatus,
          statusHistory: {
            push: {
              status: targetStatus,
              timestamp: new Date().toISOString(),
              note: rule.action,
              actorId: context.actorId,
              reason: context.reason,
            },
          },
          ...(targetStatus === OrderStatus.ORDER_ACCEPTED && {
            vendorAcceptedAt: new Date(),
          }),
          ...(targetStatus === OrderStatus.ORDER_ASSIGNED && {
            driverAssignedAt: new Date(),
          }),
          ...(targetStatus === OrderStatus.PICKED_UP && {
            pickupTime: new Date(),
          }),
          ...(targetStatus === OrderStatus.DELIVERED && {
            deliveryTime: new Date(),
          }),
        },
      });

      // Log activity
      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: context.actorId,
          actorRole: context.actorRole,
          action: rule.action,
          fromStatus: current,
          toStatus: targetStatus,
          reason: context.reason,
          metadata: context.metadata,
        },
      });

      // Fire background job for side effects (notifications, etc.)
      await this.orderQueue.add(
        rule.action,
        { orderId, context },
        { attempts: 3 },
      );

      return updated;
    });
  }

  async initiateDriverSearch(
    orderId: string,
    vendorLocation: { lat: number; lng: number },
  ) {
    try {
      // Create assignment record
      const assignment = await this.prisma.driverAssignment.create({
        data: { orderId, assignmentStatus: AssignmentStatus.PENDING },
      });

      // Enqueue the search job
      await this.assignmentQueue.add(
        'search-and-notify',
        { orderId, assignmentId: assignment.id, vendorLocation },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      this.logger.log(`Driver search initiated for order ${orderId}`);
    } catch (error) {
      this.logger.error(
        `Failed to initiate driver search for order ${orderId}`,
        error, //.stack,
      );
      throw error;
    }
  }

  async findAndNotifyDrivers(
    orderId: string,
    vendorLocation: { lat: number; lng: number },
  ) {
    try {
      const drivers: NearbyDriver[] = await this.getNearbyDrivers(
        vendorLocation.lat,
        vendorLocation.lng,
        5000, // 5 km radius
      );

      if (drivers.length === 0) {
        await this.handleNoDrivers(orderId);
        return;
      }

      const pendingKey = `order:${orderId}:pending`;
      await this.redis.setex(pendingKey, 60, 'awaiting_driver');

      for (const driver of drivers) {
        await this.notificationQueue.add(
          'notify-driver',
          {
            driverId: driver.userId,
            orderId,
            vendorLocation,
            pendingKey,
          },
          {
            jobId: `notify-${orderId}-${driver.userId}`,
            attempts: 2,
            backoff: 1000,
          },
        );
      }

      // Timeout job (60 seconds) – if no driver claims, escalate
      await this.assignmentQueue.add(
        'assignment-timeout',
        { orderId, pendingKey },
        {
          delay: 60000,
          jobId: `timeout-${orderId}`,
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `Notified ${drivers.length} drivers for order ${orderId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error in findAndNotifyDrivers for order ${orderId}`,
        error.stack,
      );
      throw error;
    }
  }

  async getNearbyDrivers(
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<NearbyDriver[]> {
    // Assumes PostGIS extension (earthdistance) is enabled
    return this.prisma.$queryRaw<NearbyDriver[]>`
      SELECT
        dp.user_id AS "userId",
        dp.latitude AS "lat",
        dp.longitude AS "lng"
      FROM driver_profiles dp
      WHERE dp.status = 'ONLINE'
        AND earth_distance(
          ll_to_earth(${lat}, ${lng}),
          ll_to_earth(dp.latitude, dp.longitude)
        ) <= ${radiusMeters}
      ORDER BY earth_distance(
        ll_to_earth(${lat}, ${lng}),
        ll_to_earth(dp.latitude, dp.longitude)
      ) ASC
      LIMIT 10
    `;
  }

  async driverAccepts(orderId: string, driverId: string): Promise<boolean> {
    const pendingKey = `order:${orderId}:pending`;
    const claimKey = `order:${orderId}:claimed_by`;

    const claimed = await this.redis.eval(
      CLAIM_SCRIPT,
      2,
      pendingKey,
      claimKey,
      driverId,
    );
    if (!claimed) {
      this.logger.warn(
        `Driver ${driverId} tried to claim already assigned order ${orderId}`,
      );
      return false;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Update assignment record
        await tx.driverAssignment.update({
          where: { orderId },
          data: {
            driverId,
            assignmentStatus: AssignmentStatus.ASSIGNED,
            assignedAt: new Date(),
          },
        });

        // Update order status (transition is handled via OrderStatusService later, but we update directly for consistency)
        // await tx.order.update({
        //   where: { id: orderId },
        //   data: {
        //     orderStatus: OrderStatus.ORDER_ASSIGNED,
        //     assignedDriverId: driverId,
        //   },
        // });

        // Update order status (transition is handled via OrderStatusService later, but we update directly for consistency)
        await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: OrderStatus.ORDER_ASSIGNED }, // ✅ removed assignedDriverId
        });

        // Mark driver as busy
        await tx.driverProfile.update({
          where: { userId: driverId },
          data: { status: DriverStatus.BUSY },
        });

        // Log activity
        await tx.orderActivityLog.create({
          data: {
            orderId,
            actorId: driverId,
            actorRole: Role.DISPATCHER,
            action: 'DRIVER_ACCEPTED',
            toStatus: OrderStatus.ORDER_ASSIGNED,
          },
        });
      });

      // Cancel the timeout job
      await this.assignmentQueue.remove(`timeout-${orderId}`);

      // Start ETA & navigation
      await this.startEtaAndNavigation(orderId, driverId);

      this.logger.log(
        `Driver ${driverId} successfully assigned to order ${orderId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Database transaction failed for driver ${driverId} on order ${orderId}`,
        error.stack,
      );
      // Release the claim in Redis? Not needed – the order is now in inconsistent state.
      // Better to delete the claim key so that another driver can try.
      await this.redis.del(claimKey);
      throw error;
    }
  }

  async startEtaAndNavigation(orderId: string, driverId: string) {
  try {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { store: true } } },
    });
    if (!order) throw new Error('Order not found');

    const driver = await this.prisma.driverProfile.findUnique({ where: { userId: driverId } });
    if (!driver?.latitude || !driver?.longitude) throw new Error('Driver location missing');

    const pickupLocation = order.pickupLocation as any;
    const store = order.items[0]?.store;
    const vendorLat = store?.latitude ?? pickupLocation?.latitude ?? pickupLocation?.lat;
    const vendorLng = store?.longitude ?? pickupLocation?.longitude ?? pickupLocation?.lng;
    if (!vendorLat || !vendorLng) throw new Error('Vendor location missing');

    const origin = { lat: driver.latitude, lng: driver.longitude };
    const destination = { lat: vendorLat, lng: vendorLng };

    const { durationSec, polyline } = await this.getRouteDetails(origin, destination);

    // Store leg state in Redis (TTL 2 hours)
    await this.redis.setex(`order:${orderId}:leg`, 7200, 'to-vendor');
    await this.redis.setex(`order:${orderId}:destination`, 7200, JSON.stringify(destination));
    await this.redis.setex(`order:${orderId}:polyline`, 7200, polyline);

    // Emit initial data
    await this.mapGateway.emitEta(orderId, durationSec, 'to-vendor');
    await this.mapGateway.emitPolyline(orderId, polyline, 'to-vendor');
    await this.mapGateway.emitDriverLocation(orderId, {
      lat: driver.latitude,
      lng: driver.longitude,
      heading: 0,
    });

    // Schedule periodic ETA updates (every 10 seconds)
    await this.assignmentQueue.add(
      'update-eta',
      { orderId, driverId, leg: 'to-vendor' },
      { repeat: { every: 10000, limit: 360 }, jobId: `eta-${orderId}` }
    );

    this.logger.log(`Navigation started for order ${orderId}, ETA ${durationSec}s`);
  } catch (error) {
    this.logger.error(`Failed to start navigation for order ${orderId}`, error.stack);
    await this.sendGenericAlert(orderId, 'Navigation temporarily unavailable');
  }
}

  private async startEtaAndNavigationOld(orderId: string, driverId: string) {
    try {
      // Fetch order details with driver, store, and customer location
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: { store: true },
          },
        },
      });
      if (!order) throw new Error('Order not found');

      const driver = await this.prisma.driverProfile.findUnique({
        where: { userId: driverId },
      });
      if (!driver || !driver.latitude || !driver.longitude) {
        throw new Error('Driver location not available');
      }

      // Get vendor location from first store (or from order.pickupLocation)
      const store = order.items[0]?.store;
      // const vendorLat =
      //    store?.latitude ?? JSON.parse(order.pickupLocation || '{}').lat;
      // const vendorLng =
      //   store?.longitude ?? JSON.parse(order.pickupLocation || '{}').lng;
      const pickupLocation = order.pickupLocation as any;

      const vendorLat =
        store?.latitude ?? pickupLocation?.latitude ?? pickupLocation?.lat;

      const vendorLng =
        store?.longitude ?? pickupLocation?.longitude ?? pickupLocation?.lng;

      if (!vendorLat || !vendorLng) {
        throw new Error('Vendor location not available');
      }

      // Leg 1: Driver → Vendor
      const etaToVendor = await this.getRouteDetails(
        { lat: driver.latitude, lng: driver.longitude },
        { lat: vendorLat, lng: vendorLng },
      );

      // Emit initial ETA via WebSocket
      await this.mapGateway.emitEta(orderId, etaToVendor.durationSec, 'to-vendor');
      await this.mapGateway.emitDriverLocation(orderId, {
        lat: driver.latitude,
        lng: driver.longitude,
        heading: 0,
      });

      // Start periodic driver location polling (e.g., every 5 seconds)
      // This would be handled by a separate process (e.g., driver sends location updates via WebSocket)
      // We'll just set up a one-time event to switch leg when pickup is confirmed.

      // Store leg state in Redis for later use
      await this.redis.setex(`order:${orderId}:leg`, 3600, 'to-vendor');

      this.logger.log(
        `ETA & navigation started for order ${orderId}, leg to vendor: ${etaToVendor.durationSec}s`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to start ETA/navigation for order ${orderId}`,
        error.stack,
      );
      // Fallback: still notify vendor/customer via push?
      await this.sendGenericAlert(
        orderId,
        'Navigation temporarily unavailable',
      );
    }
  }

  async switchToCustomerLeg(orderId: string, driverId: string) {
  const order = await this.prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  const dropoff = order.dropoffLocation as any;
  if (!dropoff?.lat || !dropoff?.lng) {
    this.logger.error(`No dropoff location for order ${orderId}`);
    return;
  }

  const driver = await this.prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!driver?.latitude || !driver?.longitude) return;

  const origin = { lat: driver.latitude, lng: driver.longitude };
  const destination = { lat: dropoff.lat, lng: dropoff.lng };
  const { durationSec, polyline } = await this.getRouteDetails(origin, destination);

  // Update Redis leg and destination
  await this.redis.setex(`order:${orderId}:leg`, 7200, 'to-customer');
  await this.redis.setex(`order:${orderId}:destination`, 7200, JSON.stringify(destination));
  await this.redis.setex(`order:${orderId}:polyline`, 7200, polyline);

  // Emit new ETA & polyline
  await this.mapGateway.emitEta(orderId, durationSec, 'to-customer');
  await this.mapGateway.emitPolyline(orderId, polyline, 'to-customer');

  // Change the recurring job to use the new leg
  await this.assignmentQueue.removeRepeatableByKey(`eta-${orderId}`);
  await this.assignmentQueue.add(
    'update-eta',
    { orderId, driverId, leg: 'to-customer' },
    { repeat: { every: 10000 }, jobId: `eta-${orderId}` }
  );

  this.logger.log(`Switched to customer leg for order ${orderId}, ETA ${durationSec}s`);
}

  async switchToCustomerLegOld(orderId: string, driverId: string) {
    // Called after driver confirms pickup (PICKED_UP status)
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return;

    const dropoff = order.dropoffLocation as any;
    if (!dropoff?.lat || !dropoff?.lng) {
      this.logger.error(`No dropoff location for order ${orderId}`);
      return;
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
    });
    if (!driver?.latitude || !driver?.longitude) return;

    const etaToCustomer = await this.getRouteDetails(
      { lat: driver.latitude, lng: driver.longitude },
      { lat: dropoff.lat, lng: dropoff.lng },
    );
    //await this.mapGateway.emitEta(orderId, etaToCustomer.durationSec, 'to-customer');

    await this.mapGateway.emitEta(orderId, etaToCustomer.durationSec, 'to-customer');
    await this.redis.setex(`order:${orderId}:leg`, 3600, 'to-customer');
    this.logger.log(
      `Switched to customer leg for order ${orderId}, ETA: ${etaToCustomer}s`,
    );
  }

  // inside DriverAssignmentService
public async getRouteDetails(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<{ durationSec: number; polyline: string }> {
  if (!this.googleMapsApiKey) {
    // Fallback: no polyline, approximate duration
    const durationSec = this.estimateEtaFallback(origin, destination);
    return { durationSec, polyline: '' };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${this.googleMapsApiKey}`;
    const response = await axios.get(url, { timeout: 5000 });
    const route = response.data.routes[0];
    if (!route) throw new Error('No route found');
    const leg = route.legs[0];
    return {
      durationSec: leg.duration.value,
      polyline: route.overview_polyline.points,
    };
  } catch (error) {
    this.logger.warn(`Directions API failed, using fallback`, error.message);
    const durationSec = this.estimateEtaFallback(origin, destination);
    return { durationSec, polyline: '' };
  }
}

private estimateEtaFallback(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): number {
  // Simple straight-line distance at 60 km/h
  const dx = (destination.lng - origin.lng) * 111320 * Math.cos(origin.lat * Math.PI / 180);
  const dy = (destination.lat - origin.lat) * 110574;
  const distanceMeters = Math.sqrt(dx * dx + dy * dy);
  return Math.round(distanceMeters / 16.667); // seconds
}

  // private async calculateEta(
  //   origin: { lat: number; lng: number },
  //   destination: { lat: number; lng: number },
  // ): Promise<number> {
  //   if (!this.googleMapsApiKey) {
  //     // Fallback: simple Euclidean distance approximation (km) * 2 min per km
  //     const R = 6371; // km
  //     const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
  //     const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;
  //     const a =
  //       Math.sin(dLat / 2) * Math.sin(dLat / 2) +
  //       Math.cos((origin.lat * Math.PI) / 180) *
  //       Math.cos((destination.lat * Math.PI) / 180) *
  //       Math.sin(dLng / 2) *
  //       Math.sin(dLng / 2);
  //     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  //     const distanceKm = R * c;
  //     return Math.round(distanceKm * 120); // 2 min per km => seconds
  //   }

  //   try {
  //     const response = await axios.get(
  //       'https://maps.googleapis.com/maps/api/distancematrix/json',
  //       {
  //         params: {
  //           origins: `${origin.lat},${origin.lng}`,
  //           destinations: `${destination.lat},${destination.lng}`,
  //           key: this.googleMapsApiKey,
  //           units: 'metric',
  //         },
  //         timeout: 5000,
  //       },
  //     );
  //     const element = response.data.rows[0]?.elements[0];
  //     if (element?.status === 'OK') {
  //       return element.duration.value; // seconds
  //     }
  //     throw new Error(`Google Maps returned status: ${element?.status}`);
  //   } catch (error) {
  //     this.logger.warn(`ETA calculation failed, using fallback`, error.message);
  //     // Fallback to simple straight‑line estimate (60 km/h)
  //     const dx =
  //       (destination.lng - origin.lng) *
  //       111320 *
  //       Math.cos((origin.lat * Math.PI) / 180);
  //     const dy = (destination.lat - origin.lat) * 110574;
  //     const distanceMeters = Math.sqrt(dx * dx + dy * dy);
  //     return Math.round(distanceMeters / 16.667); // 16.667 m/s = 60 km/h
  //   }
  // }

async handleNoDrivers(orderId: string, attempt: number = 1) {
  this.logger.warn(`No drivers found for order ${orderId}, attempt ${attempt}`);

  const maxAttempts = 3;
  const radii = [5000, 10000, 20000]; // meters – expand each retry

  if (attempt <= maxAttempts) {
    const nextRadius = radii[attempt - 1] || 20000;
    this.logger.log(`Retrying driver search for order ${orderId} with radius ${nextRadius}m`);
    await this.assignmentQueue.add(
      'retry-driver-search',
      { orderId, radius: nextRadius, attempt: attempt + 1 },
      { delay: 30000, jobId: `retry-${orderId}-${attempt}`, attempts: 1, removeOnComplete: true }
    );
    return;
  }

  // All retries exhausted – cancel the order
  this.logger.error(`No drivers found after ${maxAttempts} attempts for order ${orderId}, cancelling order`);

  await this.prisma.$transaction(async (tx) => {
    // Mark assignment as failed
    await tx.driverAssignment.update({
      where: { orderId },
      data: { assignmentStatus: AssignmentStatus.FAILED },
    });

    // Update order status to CANCELLED
    await tx.order.update({
      where: { id: orderId },
      data: { orderStatus: OrderStatus.CANCELLED },
    });

    // Log activity
    await tx.orderActivityLog.create({
      data: {
        orderId,
        actorId: 'system',
        action: 'NO_DRIVERS_AFTER_RETRIES',
        toStatus: OrderStatus.CANCELLED,
        reason: 'No available drivers after multiple attempts',
      },
    });
  });

  // Notify admin/dispatcher (existing method)
  await this.notifyDispatcherNoDrivers(orderId);

  // Notify customer about cancellation
  await this.sendOrderCancelled(orderId, 'No drivers available in your area');
}

// Inside DriverAssignmentService
private async sendOrderCancelled(orderId: string, reason?: string): Promise<void> {
  try {
    // Fetch order with customer details
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { user: { select: { id: true, email: true, firstName: true } } },
    });
    if (!order) {
      this.logger.warn(`Order ${orderId} not found for cancellation notification`);
      return;
    }

    const customerId = order.userId;
    const orderNumber = order.orderNumber;
    const body = reason
      ? `Your order #${orderNumber} has been cancelled. Reason: ${reason}`
      : `Your order #${orderNumber} has been cancelled.`;

    // 1. Create in-app notification
    await this.prisma.notification.create({
      data: {
        userId: customerId,
        type: NotificationType.ORDER_STATUS,
        title: 'Order Cancelled',
        body,
        data: { orderId, orderNumber, reason },
      },
    });

    // 2. Send email
    if (order.user?.email) {
      await this.zohoEmailProvider.sendEmail(
        order.user.email,
        `Order #${orderNumber} Cancelled`,
        `<p>${body}</p><p>If you have any questions, please contact support.</p>`,
      );
    }

    // 3. Send push notification (if you have a customer push service)
    if (this.pushService && typeof this.pushService.sendToCustomer === 'function') {
      await this.pushService.sendToCustomer(customerId, {
        title: 'Order Cancelled',
        body,
        data: { orderId },
      });
    } else {
      this.logger.debug(`Push notification not sent – sendToCustomer not implemented`);
    }

    this.logger.log(`Cancellation notification sent for order ${orderId}`);
  } catch (error) {
    this.logger.error(`Failed to send cancellation notification for order ${orderId}`, error.stack);
    // Do not throw – non-critical
  }
}

  /**
   * Notify all admins/dispatchers that no driver is available for an order.
   * Sends email + creates in‑app notification.
   */
  async notifyDispatcherNoDrivers(orderId: string): Promise<void> {
    try {
      // Fetch order details for context
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { orderNumber: true, totalAmount: true, userId: true },
      });
      if (!order) {
        this.logger.warn(
          `Order ${orderId} not found when notifying dispatchers`,
        );
        return;
      }

      // Fetch all users with role ADMIN or DISPATCHER
      const dispatchers = await this.prisma.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.DISPATCHER] }, isActive: true },
        select: { id: true, email: true, firstName: true },
      });

      if (dispatchers.length === 0) {
        this.logger.warn(
          `No active admin/dispatcher users found for order ${orderId}`,
        );
        return;
      }

      // Create a database notification for each dispatcher
      const notificationPromises = dispatchers.map((dispatcher) =>
        this.prisma.notification.create({
          data: {
            userId: dispatcher.id,
            type: NotificationType.DRIVER_ASSIGNMENT,
            title: 'No Driver Available',
            body: `Order #${order.orderNumber} (₦${order.totalAmount}) has no nearby drivers. Please take action.`,
            data: {
              orderId,
              orderNumber: order.orderNumber,
              type: 'no_drivers',
            },
          },
        }),
      );

      // Send email to each dispatcher
      const emailPromises = dispatchers.map((dispatcher) =>
        this.zohoEmailProvider.sendEmail(
          dispatcher.email,
          'Urgent: No Driver Available for Order',
          `
            <h2>No Driver Found</h2>
            <p>Order #${order.orderNumber} (Amount: ₦${order.totalAmount}) has no available drivers within the search radius.</p>
            <p>Please log in to the admin dashboard to manually assign a driver or expand the search area.</p>
            <a href="${process.env.ADMIN_PANEL_URL}/orders/${orderId}">View Order</a>
          `,
        ),
      );

      await Promise.all([...notificationPromises, ...emailPromises]);

      // Optional: Send a WebSocket event to all connected admin/dispatcher clients
      // (if you have an admin gateway)
      // await this.adminGateway.emitNoDriversAlert(orderId, order.orderNumber);

      this.logger.log(
        `Notified ${dispatchers.length} dispatchers about order ${orderId} having no drivers`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify dispatchers for order ${orderId}`,
        error,
      );
      // Do not throw – non‑critical failure
    }
  }

  /**
   * Send a generic alert to both vendor and customer (and optionally dispatcher).
   * Used for fallback messages like "Navigation temporarily unavailable".
   */
  async sendGenericAlert(orderId: string, message: string): Promise<void> {
    try {
      // Fetch order details with vendor and customer
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { store: { select: { userId: true } } } },
          user: { select: { id: true, email: true, firstName: true } },
        },
      });
      if (!order) {
        this.logger.warn(`Order ${orderId} not found for generic alert`);
        return;
      }

      // Get vendor IDs (unique stores)
      const vendorIds = [
        ...new Set(
          order.items.map((item) => item.store?.userId).filter(Boolean),
        ),
      ];

      // Prepare notification data
      const notificationData = {
        orderId,
        orderNumber: order.orderNumber,
        alertMessage: message,
      };

      // 1. Create in‑app notifications for customer
      if (order.user?.id) {
        await this.prisma.notification.create({
          data: {
            userId: order.user.id,
            type: NotificationType.ORDER_STATUS,
            title: 'Order Alert',
            body: message,
            data: notificationData,
          },
        });
      }

      // 2. Create in‑app notifications for each vendor
      for (const vendorId of vendorIds) {
        await this.prisma.notification.create({
          data: {
            userId: vendorId,
            type: NotificationType.ORDER_STATUS,
            title: 'Order Alert',
            body: message,
            data: notificationData,
          },
        });
      }

      // 3. Send real‑time WebSocket events (if gateways are available)
      if (order.user?.id) {
        // Assuming you have a customer gateway
        // await this.customerGateway.sendAlert(order.user.id, message);
      }
      for (const vendorId of vendorIds) {
        this.vendorNotificationGateway.sendToVendor(vendorId, 'order-alert', {
          orderId,
          message,
        });
      }

      // 4. Optionally also send email for critical alerts (e.g., navigation failure)
      const isCritical =
        message.toLowerCase().includes('unavailable') ||
        message.toLowerCase().includes('failed');
      if (isCritical) {
        // Send email to customer
        if (order.user?.email) {
          await this.zohoEmailProvider.sendEmail(
            order.user.email,
            `Order #${order.orderNumber} Alert`,
            `<p>${message}</p><p>We are working to resolve the issue. Please check the app for updates.</p>`,
          );
        }
        // Send email to vendors
        for (const vendorId of vendorIds) {
          const vendor = await this.prisma.user.findUnique({
            where: { id: vendorId },
            select: { email: true },
          });
          if (vendor?.email) {
            await this.zohoEmailProvider.sendEmail(
              vendor.email,
              `Order #${order.orderNumber} Alert`,
              `<p>${message}</p><p>Please monitor the order in your vendor portal.</p>`,
            );
          }
        }
      }

      this.logger.log(`Generic alert sent for order ${orderId}: "${message}"`);
    } catch (error) {
      this.logger.error(
        `Failed to send generic alert for order ${orderId}`,
        error, //.stack,
      );
      // Swallow – non‑critical
    }
  }

  // /**
  //  * Send order cancelled notification to customer (used in vendor decline flow).
  //  */
  // async sendOrderCancelled(
  //   customerId: string,
  //   orderNumber: string,
  //   reason?: string,
  // ): Promise<void> {
  //   try {
  //     const body = reason
  //       ? `Your order #${orderNumber} has been cancelled by the vendor. Reason: ${reason}`
  //       : `Your order #${orderNumber} has been cancelled.`;

  //     await this.prisma.notification.create({
  //       data: {
  //         userId: customerId,
  //         type: NotificationType.ORDER_STATUS,
  //         title: 'Order Cancelled',
  //         body,
  //         data: { orderNumber, reason },
  //       },
  //     });

  //     // Send email
  //     const user = await this.prisma.user.findUnique({
  //       where: { id: customerId },
  //       select: { email: true },
  //     });
  //     if (user?.email) {
  //       await this.zohoEmailProvider.sendEmail(
  //         user.email,
  //         `Order #${orderNumber} Cancelled`,
  //         `<p>${body}</p><p>If you have any questions, please contact support.</p>`,
  //       );
  //     }
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to send order cancelled notification for order ${orderNumber}`,
  //       error.stack,
  //     );
  //   }
  // }

  /**
   * Notify driver about a new delivery request (push + in-app).
   * Called from DriverNotificationProcessor.
   */
  async sendDriverPickupAlert(
    driverId: string,
    orderId: string,
    vendorLocation: any,
  ): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { orderNumber: true, pickupLocation: true },
      });
      if (!order) return;

      await this.prisma.notification.create({
        data: {
          userId: driverId,
          type: NotificationType.DRIVER_ASSIGNMENT,
          title: 'New Delivery Request',
          body: `Order #${order.orderNumber} - Tap to accept or decline`,
          data: { orderId, vendorLocation, orderNumber: order.orderNumber },
        },
      });

      // Push notification (FCM/APNS) – integrate with your push service
      await this.pushService.sendToDriver(driverId, {
        title: 'New Order',
        body: 'A New Order has been placed',
      });
    } catch (error) {
      this.logger.error(
        `Failed to send driver pickup alert for order ${orderId}`,
        error,
      );
    }
  }

  /**
   * Notify vendor that a new order has been placed.
   */
  async sendVendorOrderPlaced(
    vendorId: string,
    orderId: string,
    orderNumber: string,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: vendorId,
        type: NotificationType.VENDOR_ACTION_REQUIRED,
        title: 'New Order',
        body: `Order #${orderNumber} requires your action`,
        data: { orderId, orderNumber },
      },
    });
    this.vendorNotificationGateway.sendToVendor(vendorId, 'order-placed', {
      orderId,
      orderNumber,
    });
  }

  async handleDriverLocation(
    @MessageBody() data: { driverId: string; orderId: string; lat: number; lng: number; heading: number }
  ) {
    // Store latest location (Redis or DB)
    await this.redis.geoadd('driver:locations', data.lng, data.lat, data.driverId);

    // Optional: update driver profile
    // await this.prisma.driverProfile.update({
    //   where: { userId: data.driverId },
    //   data: {
    //     latitude: data.lat,
    //     longitude: data.lng,
    //   },
    // });

    // Forward to customer tracking the order
    this.mapGateway.emitDriverLocation(data.orderId, { lat: data.lat, lng: data.lng, heading: data.heading });


  }

  async updateDriverLocation(driverId: string, orderId: string, lat: number, lng: number, heading: number) {
  // Store latest location in Redis (GeoSet or simple key)
  await this.redis.geoadd('driver:locations', lng, lat, driverId);
  await this.redis.setex(`driver:${driverId}:loc`, 30, JSON.stringify({ lat, lng, heading }));
  // Also store the current orderId for the driver
  if (orderId) await this.redis.setex(`driver:${driverId}:order`, 3600, orderId);

  // Forward to customer's WebSocket
  await this.mapGateway.emitDriverLocation(orderId, { lat, lng, heading });
}

async stopEtaUpdates(orderId: string) {
  const job = await this.assignmentQueue.getRepeatableJobs();
  for (const j of job) {
    if (j.id === `eta-${orderId}`) {
      await this.assignmentQueue.removeRepeatableByKey(j.key);
    }
  }
}
}
