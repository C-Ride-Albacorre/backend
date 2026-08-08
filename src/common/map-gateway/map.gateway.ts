import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DriverAssignmentService } from '../../modules/driver/driver-assignment.service';
import { OrderStatus } from '@prisma/client';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';

@WebSocketGateway({ namespace: 'map', cors: true })
export class MapGateway implements OnGatewayConnection, OnGatewayDisconnect {

  private readonly logger = new Logger(MapGateway.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // @Inject(forwardRef(() => DriverAssignmentService))
    // private readonly driverAssignmentService: DriverAssignmentService,
  ) { }

  @WebSocketServer() server: Server;

  handleConnection(client: Socket) {
    const orderId = client.handshake.query.orderId as string;
    if (orderId) client.join(`order:${orderId}`);
  }

  handleDisconnect(client: Socket) { }

  @SubscribeMessage('subscribe-order')
  handleSubscribe(client: Socket, orderId: string) {
    client.join(`order:${orderId}`);
  }

  ///

  // emitDriverLocation(
  //   orderId: string,
  //   location: { lat: number; lng: number; heading: number },
  // ) {

  //   this.server.to(`order:${orderId}`).emit('driver-location', location);
  // }
  async emitDriverLocation(
    orderId: string,
    location: { lat: number; lng: number; heading: number },
  ): Promise<void> {
    // 1. Emit WebSocket event (fire-and-forget, but wrap in try/catch if server might be null)
    try {
      this.server.to(`order:${orderId}`).emit('driver-location', location);
    } catch (emitErr) {
      this.logger.error(`WebSocket emit failed for order ${orderId}`, emitErr);
    }

    // 2. Store in Redis for sync endpoint
    const key = `order:${orderId}:driver-location`;
    const value = JSON.stringify({
      lat: location.lat,
      lng: location.lng,
      heading: location.heading,
      timestamp: Date.now(),
    });

    try {
      await this.redis.setex(key, 30, value);
      this.logger.debug(`Stored driver location for order ${orderId}`);
    } catch (redisErr) {
      // Log the error but don't break the flow – the WebSocket emit already happened.
      this.logger.error(`Redis storage failed for order ${orderId}`, redisErr);
    }
  }

  emitDriverLocationOld(
    orderId: string,
    location: { lat: number; lng: number; heading: number },
  ) {

    // 1. Emit WebSocket event
    this.server.to(`order:${orderId}`).emit('driver-location', location);

    // 2. Store in Redis for sync endpoint
    //    We need to know which driver is assigned to this order.
    //    Option A: Store under order key (overwrites with latest location)
    //    Option B: Store under driver key (already used by sync)
    //    We'll store under order key for easy sync retrieval.
    const key = `order:${orderId}:driver-location`;
    const value = JSON.stringify({
      lat: location.lat,
      lng: location.lng,
      heading: location.heading,
      timestamp: Date.now(),
    });
    this.logger.log(`Storing driver location in Redis for order ${orderId}: ${value}`);
    this.redis.setex(key, 30, value); // 30 seconds TTL (short, as driver moves)
  }

  // emitEta(
  //   orderId: string,
  //   etaSeconds: number,
  //   leg: 'to-vendor' | 'to-customer',
  // ) {
  //   this.server.to(`order:${orderId}`).emit('eta-update', { leg, etaSeconds });
  // }

  // In DriverAssignmentService or MapGateway
  emitEta(orderId: string, etaSeconds: number, leg: 'to-vendor' | 'to-customer') {
    // 1. Emit WebSocket event
    this.server.to(`order:${orderId}`).emit('eta-update', { leg, etaSeconds });

    // 2. Store in Redis for sync endpoint
    const key = `order:${orderId}:eta`;
    const value = JSON.stringify({ leg, etaSeconds });
    this.logger.log(`Storing ETA in Redis for order ${orderId}: ${value}`);
    this.redis.setex(key, 300, value); // 5 minutes TTL
  }

  // emitPolyline(orderId: string, polyline: string, leg: 'to-vendor' | 'to-customer') {
  //   this.server.to(`order:${orderId}`).emit('polyline-update', { leg, polyline });
  // }
  emitPolyline(orderId: string, polyline: string, leg: 'to-vendor' | 'to-customer') {
    // 1. Emit WebSocket event
    this.server.to(`order:${orderId}`).emit('polyline-update', { leg, polyline });

    // 2. Store in Redis for sync endpoint (overwrite previous)
    const key = `order:${orderId}:polyline`;
    this.redis.setex(key, 3600, polyline); // 1 hour TTL
  }

  emitOrderStatus(orderId: string, status: OrderStatus, history?: any) {
    this.server.to(`order:${orderId}`).emit('order-status', { status, history });
  }

  // order.gateway.ts
  // emitOrderStatus(orderId: string, status: OrderStatus, history: any[]) {
  //   this.server.to(`order:${orderId}`).emit('order-status', {
  //     status,
  //     history, // array of { status, timestamp, note, actorId, ... }
  //   });
  // }
}
