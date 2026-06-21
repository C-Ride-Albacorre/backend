// driver.gateway.ts
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
    WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { forwardRef, Inject, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { DriverStatus } from '@prisma/client';
import { DriverAssignmentService } from '../../modules/driver/driver-assignment.service';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DriverService } from 'src/modules/driver/driver.service';




@WebSocketGateway({
  namespace: 'driver',
  cors: {
    origin: '*',
  },
})


export class DriverGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private formatOrderForDriver(
  order: any,
  items: any[] = [],
) {
  return {
    order_id: order.id,
    order_number: order.orderNumber,
    order_status: order.orderStatus,
    total_amount: order.totalAmount,

    pickup_location: {
      address: order.pickupLocation?.address,
      storeId: order.pickupLocation?.storeId,
      latitude: order.pickupLocation?.latitude,
      longitude: order.pickupLocation?.longitude,
      storeName: order.pickupLocation?.storeName,
    },

    dropoff_location: {
      address: order.dropoffLocation?.address,
      city: order.dropoffLocation?.city,
      state: order.dropoffLocation?.state,
      country: order.dropoffLocation?.country,
      postalCode: order.dropoffLocation?.postalCode,
    },

    created_at: order.createdAt,

    store_id: order.store?.id,
    store_name: order.store?.storeName,
    store_logo: order.store?.storeLogo,
    store_lat: order.store?.latitude,
    store_lng: order.store?.longitude,

    distance_meters: order.distanceMeters ?? 0,

    rn: '1',

    items,
  };
}

  private readonly logger = new Logger(DriverGateway.name);
  private driverSockets = new Map<string, string>(); // driverId -> socketId

  

      constructor(
        @Inject(forwardRef(() => DriverAssignmentService))
        private readonly driverAssignmentService: DriverAssignmentService,
        private readonly driverService: DriverService,
        private jwtService: JwtService
    ) { }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      const driverId = client.handshake.query.driverId as string;

      if (!token || !driverId) {
        this.logger.warn(`Connection rejected: missing token or driverId`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const decoded = this.jwtService.verify(token);
      if (decoded.sub !== driverId) {
        this.logger.warn(`Connection rejected: token mismatch`);
        client.disconnect();
        return;
      }

      // Store connection
      this.driverSockets.set(driverId, client.id);
      client.data.driverId = driverId;
      
      this.logger.log(`Driver ${driverId} connected with socket ${client.id}`);
      
      // Send connection confirmation
      client.emit('connected', { driverId, status: 'online' });
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const driverId = client.data.driverId;
    if (driverId) {
      this.driverSockets.delete(driverId);
      this.logger.log(`Driver ${driverId} disconnected`);
    }
  }

  /**
   * Send a new order request to a specific driver
   */
  // emitNewOrderRequest(driverId: string, orderData: any) {
  //   const socketId = this.driverSockets.get(driverId);
  //   if (socketId) {
  //     this.server.to(socketId).emit('new-order-request', {
  //       orderId: orderData.orderId,
  //       orderNumber: orderData.orderNumber,
  //       orderType: orderData.orderType,
  //       vendorLocation: orderData.vendorLocation,
  //       eta: orderData.eta,
  //       storeName: orderData.storeName,
  //       totalAmount: orderData.totalAmount,
  //       distance: orderData.distance,

  //       // Add any other relevant order details
  //     });
  //     this.logger.log(`Sent new order request to driver ${driverId}`);
  //     return true;
  //   } else {
  //     this.logger.warn(`Driver ${driverId} not connected`);
  //     return false;
  //   }
  // }
  async emitNewOrderRequestbk(
  driverId: string,
  order: any,
) {
  const socketId = this.driverSockets.get(driverId);

  if (!socketId) {
    this.logger.warn(
      `Driver ${driverId} not connected`,
    );
    return false;
  }

  const itemsSummary =
    await this.driverService.getOrderItemsSummary([order.id]);

  const payload =
    this.formatOrderForDriver(
      order,
      itemsSummary[order.id] || [],
    );

  this.server
    .to(socketId)
    .emit('new-order-request', payload);

  this.logger.log(
    `Sent new order request to driver ${driverId}`,
  );

  return true;
}


async emitNewOrderRequest(
  driverId: string,
  orderId: string,
  orderData: {
    vendorLocation: { lat: number; lng: number };
    orderNumber: string;
    storeId: string;
    storeName: string;
    totalAmount: number;
    orderType: string;
    storeLogo: string;
    pickupLocation: any;
    dropoffLocation: any;
    storeLat: any;
    storeLng: any;
    distance: number;
    createdAt: Date,

  },
) {
  const socketId = this.driverSockets.get(driverId);
  if (!socketId) {
    this.logger.warn(`Driver ${driverId} not connected`);
    return false;
  }

  // Fetch items summary using orderId
  let itemsSummary: Record<string, any[]> = {};
  try {
    itemsSummary = await this.driverService.getOrderItemsSummary([orderId]);
  } catch (error) {
    this.logger.error(`Failed to get order items summary: ${error.message}`);
    itemsSummary = {};
  }

  const payload = {
    order_id: orderId,
    order_number: orderData.orderNumber, // need to add this to orderData
    order_status: 'ORDER_ACCEPTED',
    total_amount: orderData.totalAmount,
    pickup_location: orderData.pickupLocation,
    dropoff_location: orderData.dropoffLocation, // add if needed
    created_at: orderData.createdAt,
    store_id: orderData.storeId,
    store_name: orderData.storeName,
    store_logo: orderData.storeLogo,
    store_lat: orderData.storeLat,
    store_lng: orderData.storeLng,
    distance_meters: orderData.distance,
    rn: '1',
    items: itemsSummary[orderId] || [],
  };

  this.server.to(socketId).emit('new-order-request', payload);
  this.logger.log(`Sent new order request to driver ${driverId}`);
  return true;
}
  /**
   * Send request timeout to driver
   */
  emitRequestTimeout(driverId: string, orderId: string) {
    const socketId = this.driverSockets.get(driverId);
    if (socketId) {
      this.server.to(socketId).emit('request-timeout', { orderId });
      this.logger.log(`Sent timeout to driver ${driverId} for order ${orderId}`);
    }
  }

  /**
   * Send order accepted by another driver
   */
  emitOrderTaken(driverId: string, orderId: string) {
    const socketId = this.driverSockets.get(driverId);
    if (socketId) {
      this.server.to(socketId).emit('order-taken', { orderId });
    }
  }

  /**
   * Send ETA updates
   */
  emitEta(orderId: string, durationSec: number, leg: 'to-vendor' | 'to-customer') {
    // Broadcast to all relevant clients (driver and customer)
    // You might want to store which driver accepted the order
    this.server.emit('eta-update', { orderId, durationSec, leg });
  }

  /**
   * Send polyline updates
   */
  emitPolyline(orderId: string, polyline: string, leg: 'to-vendor' | 'to-customer') {
    this.server.emit('polyline-update', { orderId, polyline, leg });
  }


  //
  
      /**
       * Driver sends periodic location updates.
       */
      @SubscribeMessage('driver-location')
      async handleDriverLocation(
          @ConnectedSocket() client: Socket,
          @MessageBody() data: { orderId: string; lat: number; lng: number; heading: number },
      ) {
          const driverId = client.data.user?.id;
          if (!driverId) throw new WsException('Unauthorized');
          await this.driverAssignmentService.handleDriverLocation({
              driverId,
              orderId: data.orderId,
              lat: data.lat,
              lng: data.lng,
              heading: data.heading,
          });
      }
  
      /**
       * Driver sets online/offline status.
       */
      @SubscribeMessage('driver-status')
      async handleDriverStatus(
          @ConnectedSocket() client: Socket,
          @MessageBody() data: { status: DriverStatus },
      ) {
          const driverId = client.data.user?.id;
          if (!driverId) throw new WsException('Unauthorized');
          await this.driverAssignmentService.updateDriverStatus(driverId, data.status);
          client.emit('status-updated', { status: data.status });
      }
}