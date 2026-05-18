import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'map', cors: true })
export class MapGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  handleConnection(client: Socket) {
    const orderId = client.handshake.query.orderId as string;
    if (orderId) client.join(`order:${orderId}`);
  }

  handleDisconnect(client: Socket) {}

  @SubscribeMessage('subscribe-order')
  handleSubscribe(client: Socket, orderId: string) {
    client.join(`order:${orderId}`);
  }

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
}
