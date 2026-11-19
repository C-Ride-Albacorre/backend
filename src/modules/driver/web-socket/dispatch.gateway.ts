// src/modules/dispatch/dispatch.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DriverStatus } from '@prisma/client';

import { PrismaService } from '../../../shared/services/prisma.service';

interface SelectedOrderState {
  orderId: string;
  pickup: { lat: number; lng: number };
  nearbyDriverIds: Set<string>;
}

@Injectable()
@WebSocketGateway({
  namespace: 'dispatch',
  cors: { origin: '*' },
})
export class DispatchGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DispatchGateway.name);

  @WebSocketServer() server: Server;

  // admin socketId → state of the order they're viewing
  private readonly selectedOrders = new Map<string, SelectedOrderState>();

  // driverId → set of admin socketIds watching this driver
  private readonly driverWatchers = new Map<string, Set<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ──────────────────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) return client.disconnect(true);

      const decoded = this.jwtService.verify(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(decoded.role)) {
        return client.disconnect(true);
      }

      client.data.userId = decoded.sub;
      client.data.role = decoded.role;

      this.logger.log(`Dispatcher ${decoded.sub} connected (${client.id})`);
      client.emit('connected', { userId: decoded.sub, role: decoded.role });
    } catch (err) {
      this.logger.error(`Dispatch connection error: ${err}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.cleanupSelection(client.id);
    this.logger.log(`Dispatcher ${client.data.userId} disconnected`);
  }

  // ──────────────────────────────────────────────────────────────
  // select-order → full snapshot
  // ──────────────────────────────────────────────────────────────

  @SubscribeMessage('select-order')
  async handleSelectOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId: string },
  ) {
    const { orderId } = body ?? {};
    if (!orderId) return;

    this.cleanupSelection(client.id);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { store: true } },
        user: {
          select: { firstName: true, lastName: true, phoneNumber: true, email: true },
        },
      },
    });

    if (!order) {
      client.emit('error', { message: 'Order not found' });
      return;
    }

    const pickupRaw = order.pickupLocation as any;
    const store = order.items[0]?.store;
    const pickup = {
      lat: pickupRaw?.latitude ?? pickupRaw?.lat ?? store?.latitude ?? null,
      lng: pickupRaw?.longitude ?? pickupRaw?.lng ?? store?.longitude ?? null,
    };

    if (!pickup.lat || !pickup.lng) {
      client.emit('error', { message: 'Order has no valid pickup location' });
      return;
    }

    const RADIUS_METERS = 10_000;

    const drivers = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        first_name: string;
        last_name: string;
        phoneNumber: string;
        latitude: number;
        longitude: number;
        status: DriverStatus;
        rating: number;
        license_plate: string | null;
        vehicle_type: string;
        distance_meters: number;
        updated_at: Date | null;
      }>
    >`
      SELECT
        dp."userId"       AS user_id,
        u."firstName"     AS first_name,
        u."lastName"      AS last_name,
        u."phoneNumber"   AS phoneNumber,
        dp."latitude"     AS latitude,
        dp."longitude"    AS longitude,
        dp."status"       AS status,
        dp."rating"       AS rating,
        dp."licensePlate" AS license_plate,
        dp."vehicleType"  AS vehicle_type,
        dp."locationUpdatedAt" AS updated_at,
        (
          6371000 * ACOS(
            LEAST(
              1.0,
              GREATEST(
                -1.0,
                COS(RADIANS(${pickup.lat}))
                * COS(RADIANS(dp."latitude"))
                * COS(RADIANS(dp."longitude") - RADIANS(${pickup.lng}))
                + SIN(RADIANS(${pickup.lat}))
                * SIN(RADIANS(dp."latitude"))
              )
            )
          )
        ) AS distance_meters
      FROM "DriverProfile" dp
      INNER JOIN "User" u ON u."id" = dp."userId"
      WHERE dp."status" IN ('ONLINE', 'BUSY')
        AND dp."latitude"  IS NOT NULL
        AND dp."longitude" IS NOT NULL
        AND dp."latitude"  BETWEEN ${pickup.lat - 0.1} AND ${pickup.lat + 0.1}
        AND dp."longitude" BETWEEN ${pickup.lng - 0.15} AND ${pickup.lng + 0.15}
      ORDER BY distance_meters ASC
      LIMIT 50;
    `;

    const nearby = drivers.filter(
      (d) => Number(d.distance_meters) <= RADIUS_METERS,
    );

    // Register the selection
    const state: SelectedOrderState = {
      orderId,
      pickup,
      nearbyDriverIds: new Set(nearby.map((d) => d.user_id)),
    };
    this.selectedOrders.set(client.id, state);

    for (const d of nearby) {
      const watchers = this.driverWatchers.get(d.user_id) ?? new Set();
      watchers.add(client.id);
      this.driverWatchers.set(d.user_id, watchers);
    }

    client.emit('order-context', {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        orderType: order.orderType,
        totalAmount: Number(order.totalAmount),
        deliveryFee: Number(order.deliveryFee),
        createdAt: order.createdAt,
        pickup,
        dropoff: order.dropoffLocation,
        customer: order.user
          ? {
              name: `${order.user.firstName ?? ''} ${order.user.lastName ?? ''}`.trim(),
              phone: order.user.phoneNumber,
              email: order.user.email,
            }
          : null,
        store: store
          ? { id: store.id, name: store.storeName, address: store.storeAddress }
          : null,
      },
      radiusMeters: RADIUS_METERS,
      drivers: nearby.map((d) => ({
        driverId: d.user_id,
        name: `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(),
        phoneNumber: d.phoneNumber,
        lat: Number(d.latitude),
        lng: Number(d.longitude),
        status: d.status,
        rating: d.rating,
        licensePlate: d.license_plate,
        vehicleType: d.vehicle_type,
        distanceMeters: Number(d.distance_meters),
        locationUpdatedAt: d.updated_at?.toISOString() ?? null,
      })),
      generatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `Dispatcher ${client.data.userId} selected order ${orderId} — ${nearby.length} drivers`,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Relay: called from DriverGateway when a driver moves
  // ──────────────────────────────────────────────────────────────

  emitDriverLocation(payload: {
    driverId: string;
    lat: number;
    lng: number;
    heading?: number | null;
    status: string;
    updatedAt: string;
  }) {
    const watchers = this.driverWatchers.get(payload.driverId);
    if (!watchers || watchers.size === 0) return;

    for (const socketId of watchers) {
      this.server.to(socketId).emit('driver-location', payload);
    }
  }

  emitDriverStatusChange(payload: {
    driverId: string;
    status: 'ONLINE' | 'BUSY' | 'OFFLINE';
    updatedAt: string;
  }) {
    const watchers = this.driverWatchers.get(payload.driverId);
    if (!watchers) return;

    for (const socketId of watchers) {
      this.server.to(socketId).emit('driver-status-change', payload);

      if (payload.status === 'OFFLINE') {
        this.driverWatchers.get(payload.driverId)?.delete(socketId);
        this.selectedOrders
          .get(socketId)
          ?.nearbyDriverIds.delete(payload.driverId);
      }
    }

    // Cleanup empty watcher set
    if (this.driverWatchers.get(payload.driverId)?.size === 0) {
      this.driverWatchers.delete(payload.driverId);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Order invalidated (assigned elsewhere, cancelled, etc.)
  // ──────────────────────────────────────────────────────────────

  emitSelectedOrderInvalidated(orderId: string) {
    for (const [socketId, state] of this.selectedOrders.entries()) {
      if (state.orderId === orderId) {
        this.server.to(socketId).emit('selected-order-invalidated', {
          orderId,
        });
        this.cleanupSelection(socketId);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Cleanup helper
  // ──────────────────────────────────────────────────────────────

  private cleanupSelection(socketId: string) {
    const state = this.selectedOrders.get(socketId);
    if (!state) return;

    for (const driverId of state.nearbyDriverIds) {
      this.driverWatchers.get(driverId)?.delete(socketId);
      if (this.driverWatchers.get(driverId)?.size === 0) {
        this.driverWatchers.delete(driverId);
      }
    }
    this.selectedOrders.delete(socketId);
  }
}