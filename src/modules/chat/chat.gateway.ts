import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { ChatService } from './chat.service';
import { Role } from '@prisma/client';

@WebSocketGateway({ namespace: 'chat', cors: true })
@UseGuards(WsJwtGuard)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private chatService: ChatService) {}

  handleConnection(client: Socket) {
    const userId = client.data.user?.id;
    if (!userId) client.disconnect();
  }

  handleDisconnect(client: Socket) {}

  @SubscribeMessage('join-chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() orderId: string,
  ) {
    const userId = client.data.user.id;
    const role = client.data.user.role;
    const isValid = await this.chatService.validateChatAccess(orderId, userId, role);
    if (!isValid) throw new WsException('Unauthorized');
    client.join(`chat:${orderId}`);
    client.emit('joined', { orderId });
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string; message: string; type?: string },
  ) {
    const userId = client.data.user.id;
    const role = client.data.user.role;
    const saved = await this.chatService.saveMessage({
      orderId: data.orderId,
      senderId: userId,
      senderRole: role,
      message: data.message,
      type: data.type || 'TEXT',
    });
    // Broadcast to all in the room (including sender)
    this.server.to(`chat:${data.orderId}`).emit('new-message', saved);
    // Push notification to recipient if offline
    await this.chatService.sendPushIfOffline(saved);
  }

  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string; messageId: string },
  ) {
    const userId = client.data.user.id;
    await this.chatService.markMessageAsRead(data.messageId, userId);
    this.server.to(`chat:${data.orderId}`).emit('message-read', { messageId: data.messageId });
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string; isTyping: boolean },
  ) {
    client.to(`chat:${data.orderId}`).emit('user-typing', {
      userId: client.data.user.id,
      isTyping: data.isTyping,
    });
  }
}