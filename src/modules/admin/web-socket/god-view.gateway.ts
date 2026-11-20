// src/modules/god-view/god-view.gateway.ts

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
import { DriverActivityStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/services/prisma.service';


/*
 Scale note: if you're ever at 5,000+ drivers, this broadcast becomes expensive 
 (5k drivers × every movement × every admin socket). At that scale you'd shard by region 
 or switch to a tile-based approach. For 20–500 drivers, this is perfect. Optimize when
you have the problem.
*/

@Injectable()
@WebSocketGateway({ namespace: 'god-view', cors: { origin: '*' } })
export class GodViewGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GodViewGateway.name);

  @WebSocketServer() server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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

      this.logger.log(`God-view admin ${decoded.sub} connected`);

      // Send full fleet snapshot immediately
      const snapshot = await this.buildFleetSnapshot();
      client.emit('fleet-snapshot', snapshot);
    } catch (err) {
      this.logger.error(`God-view connection error: ${err}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`God-view admin ${client.data.userId} disconnected`);
  }

  // ──────────────────────────────────────────────────────────────
  // Full snapshot on connect
  // ──────────────────────────────────────────────────────────────

  private async buildFleetSnapshot() {
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const stats: Record<DriverActivityStatus, number> = {
      AVAILABLE: 0,
      NOT_AVAILABLE: 0,
      WAY_TO_PICKUP: 0,
      ARRIVED: 0,
      WAY_TO_DELIVER: 0,
    };
    drivers.forEach((d) => {
      stats[d.activityStatus] = (stats[d.activityStatus] || 0) + 1;
    });

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        total: drivers.length,
        byStatus: stats,
      },
      drivers: drivers.map((d) => ({
        driverId: d.userId,
        name: `${d.user.firstName ?? ''} ${d.user.lastName ?? ''}`.trim(),
        phoneNumber: d.user.phoneNumber,
        lat: d.latitude,
        lng: d.longitude,
        activityStatus: d.activityStatus,
        vehicleType: d.vehicleType,
        vehicleMake: d.vehicleMake,
        vehicleModel: d.vehicleModel,
        rating: d.rating,
        locationUpdatedAt: d.locationUpdatedAt?.toISOString() ?? null,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Relay: called from DriverGateway as drivers move or change status
  // ──────────────────────────────────────────────────────────────

  emitDriverLocation(payload: {
    driverId: string;
    lat: number;
    lng: number;
    updatedAt: string;
  }) {
    this.server.emit('driver-location', payload);
  }

  emitDriverStatusChange(payload: {
    driverId: string;
    activityStatus: DriverActivityStatus;
    updatedAt: string;
  }) {
    this.server.emit('driver-status-change', payload);
  }

  emitDriverWentOffline(driverId: string) {
    this.server.emit('driver-removed', { driverId });
  }

  
}