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

  private readonly logger = new Logger(DriverGateway.name);
  private driverSockets = new Map<string, string>(); // driverId -> socketId

  constructor(
    @Inject(forwardRef(() => DriverAssignmentService))
    private readonly driverAssignmentService: DriverAssignmentService,
    private readonly driverService: DriverService,
    private jwtService: JwtService
  ) { }

  // driver.gateway.ts

private async formatAssignedOrderPayload(order: any) {
  // Fetch items summary if not already included
  let itemsSummary: Record<string, any[]> = {};
  if (order.id) {
    try {
      itemsSummary = await this.driverService.getOrderItemsSummary([order.id]);
    } catch (error) {
      this.logger.error(`Failed to get items summary for order ${order.id}`);
    }
  }

  return {
    order_id: order.id,
    order_number: order.orderNumber,
    order_status: order.orderStatus, // should be ORDER_ASSIGNED
    total_amount: order.totalAmount,
    pickup_location: order.pickupLocation,
    dropoff_location: order.dropoffLocation,
    created_at: order.createdAt,
    store_id: order.store?.id || order.items?.[0]?.store?.id,
    store_name: order.store?.storeName || order.items?.[0]?.store?.storeName || 'Store',
    store_logo: order.store?.storeLogo || order.items?.[0]?.store?.storeLogo || null,
    store_lat: order.store?.latitude || order.items?.[0]?.store?.latitude,
    store_lng: order.store?.longitude || order.items?.[0]?.store?.longitude,
    distance_meters: order.distanceMeters || 0,
    rn: '1',
    items: itemsSummary[order.id] || [],
    assigned_at: order.assignedAt || order.driverAssignedAt,
  };
}

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
      client.data.user = { id: driverId }; // add this

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
async emitNewOrderRequest(
  driverId: string,
  orderId: string,
  orderStatus: string,
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
    createdAt: Date;
  },
) {
  if (orderStatus !== 'ORDER_ACCEPTED') {
    this.logger.debug(
      `Skipping new-order-request for order ${orderId}. Status: ${orderStatus}`,
    );
    return false;
  }

  const socketId = this.driverSockets.get(driverId);
  if (!socketId) {
    this.logger.warn(`Driver ${driverId} not connected`);
    return false;
  }

  let itemsSummary: Record<string, any[]> = {};
  try {
    itemsSummary = await this.driverService.getOrderItemsSummary([orderId]);
  } catch (error) {
    this.logger.error(`Failed to get order items summary: ${error}`);
  }

  const payload = {
    order_id: orderId,
    order_number: orderData.orderNumber,
    order_status: 'ORDER_ACCEPTED',
    total_amount: orderData.totalAmount,
    pickup_location: orderData.pickupLocation,
    dropoff_location: orderData.dropoffLocation,
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


  async emitNewOrderRequestbk(
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
      this.logger.error(`Failed to get order items summary: ${error}`);
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

  // Emit event to a single driver
  emitToDriver(driverId: string, event: string, payload: any) {
    const socketId = this.driverSockets.get(driverId);
    if (socketId) {
      this.server.to(socketId).emit(event, payload);
    }
  }

  // Emit event to multiple drivers
  emitToManyDrivers(driverIds: string[], event: string, payload: any) {
    for (const id of driverIds) {
      this.emitToDriver(id, event, payload);
    }
  }

  // Broadcast that an order is no longer available
  broadcastOrderAssigned(orderId: string, assignedDriverId: string, driverIdsToExclude?: string[]) {
    const payload = {
      orderId,
      assignedDriverId,
      status: 'ASSIGNED',
      // optionally include other details
    };
    // In your driverAcc
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
    this.logger.log(`Driver Id, ${driverId}`)

    if (!driverId) throw new WsException('Unauthorized');

    // await this.driverAssignmentService.handleDriverLocation({
    await this.driverAssignmentService.updateDriverLocation(
      driverId,
      data.orderId,
      data.lat,
      data.lng,
      data.heading,
    );


  }

  /**
   * Driver sets online/offline status.
   */
  @SubscribeMessage('driver-status')
  async handleDriverStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status: DriverStatus },
  ) {
    const driverId1 = client.data.user?.id;
      const driverId = client.data.driverId; // ✅ Use this directly

    this.logger.log(`Driver Id, ${driverId}, ${driverId1}`)
    //if (!driverId) throw new WsException('Unauthorized');
    await this.driverAssignmentService.updateDriverStatus(driverId, data.status);
    client.emit('status-updated', { status: data.status });
  }


  // driver.gateway.ts

// @SubscribeMessage('subscribe-assigned-orders')
// async handleSubscribeAssignedOrders(
//   @ConnectedSocket() client: Socket,
//   @MessageBody() data: { driverId: string },
// ) {
//   const driverId = client.data.driverId || data.driverId;
//   if (!driverId) throw new WsException('Unauthorized');

//   // Join the driver’s assigned-orders room
//   const room = `driver:${driverId}:assigned`;
//   client.join(room);

//   // Fetch current assigned orders
//   const orders = await this.driverAssignmentService.getAssignedOrders(driverId);
//   const payload = await Promise.all(
//     orders.map(order => this.formatAssignedOrderPayload(order))
//   );

//   client.emit('assigned-orders-list', { orders: payload });

//   this.logger.log(`Driver ${driverId} subscribed to assigned orders`);
// }

@SubscribeMessage('subscribe-assigned-orders')
async handleSubscribeAssignedOrders(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { driverId: string },
) {
  const driverId = client.data.driverId || data.driverId;
  if (!driverId) throw new WsException('Unauthorized');

  const room = `driver:${driverId}:assigned`;
  client.join(room);

  // Send the current assigned order
  await this.emitAssignedOrder(driverId);

  this.logger.log(`Driver ${driverId} subscribed to assigned orders`);
}

// Remove emitAssignedOrdersList, add:
async emitAssignedOrder(driverId: string) {
  const room = `driver:${driverId}:assigned`;
  const orders = await this.driverAssignmentService.getAssignedOrders(driverId);
  const assignedOrder = orders.length > 0 ? orders[0] : null;
  
  let payload = null;
  if (assignedOrder) {
    payload = await this.formatAssignedOrderPayload(assignedOrder);
  }
  
  this.server.to(room).emit('active-order', { order: payload });
  this.logger.log(`Sent assigned order to driver ${driverId}: ${payload ? payload.order_id : 'none'}`);
}

}