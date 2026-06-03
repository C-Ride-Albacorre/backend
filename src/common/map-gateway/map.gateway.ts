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
import { forwardRef, Inject } from '@nestjs/common';

@WebSocketGateway({ namespace: 'map', cors: true })
export class MapGateway implements OnGatewayConnection, OnGatewayDisconnect {

  constructor(
    @Inject(forwardRef(() => DriverAssignmentService))
    private readonly driverAssignmentService: DriverAssignmentService,
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


  @SubscribeMessage('driver-location-update')
  async handleDriverLocation(
    @MessageBody()
    data: {
      driverId: string;
      orderId: string;
      lat: number;
      lng: number;
      heading: number;
    },
  ) {
    await this.driverAssignmentService.handleDriverLocation(data);
  }

  ///

  emitDriverLocation(
    orderId: string,
    location: { lat: number; lng: number; heading: number },
  ) {
    this.server.to(`order:${orderId}`).emit('driver-location', location);
  }

  emitEta(
    orderId: string,
    etaSeconds: number,
    leg: 'to-vendor' | 'to-customer',
  ) {
    this.server.to(`order:${orderId}`).emit('eta-update', { leg, etaSeconds });
  }

  emitPolyline(orderId: string, polyline: string, leg: 'to-vendor' | 'to-customer') {
    this.server.to(`order:${orderId}`).emit('polyline-update', { leg, polyline });
  }

  emitOrderStatus(orderId: string, status: OrderStatus, history?: any) {
    this.server.to(`order:${orderId}`).emit('order-status', { status, history });
  }
}
