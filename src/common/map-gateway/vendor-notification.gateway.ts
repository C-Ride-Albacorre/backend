import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'vendor', cors: true })
export class VendorNotificationGateway {
  @WebSocketServer() server: Server;

  sendToVendor(vendorId: string, event: string, data: any) {
    this.server.to(`vendor:${vendorId}`).emit(event, data);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, vendorId: string) {
    client.join(`vendor:${vendorId}`);
    client.emit('subscribed', { vendorId });
  }
}
