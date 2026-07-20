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
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';

@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: '*',
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  /**
   * userId -> socketId
   */
  private readonly userSockets = new Map<string, string>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) { }

  /**
   * Authenticate user during websocket handshake.
   */
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;

      if (!token) {
        this.logger.warn('Chat connection rejected: missing token');
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token);

      if (!decoded?.sub || !decoded?.role) {
        this.logger.warn('Chat connection rejected: invalid JWT payload');
        client.disconnect();
        return;
      }

      client.data.user = {
        id: decoded.sub,
        role: decoded.role,
      };

      this.userSockets.set(decoded.sub, client.id);

      this.logger.log(
        `User ${decoded.sub} connected with socket ${client.id}`,
      );

      client.emit('connected', {
        userId: decoded.sub,
        role: decoded.role,
        status: 'online',
      });
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.user?.id;

    if (userId) {
      this.userSockets.delete(userId);

      this.logger.log(`User ${userId} disconnected`);
    }
  }

  /**
   * Returns whether a user currently has an active socket.
   */
  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  /**
   * Emit an event to a specific connected user.
   */
  emitToUser(userId: string, event: string, payload: any): boolean {
    const socketId = this.userSockets.get(userId);

    if (!socketId) {
      this.logger.warn(
        `Cannot emit "${event}" to user ${userId}: user is offline`,
      );
      return false;
    }

    this.server.to(socketId).emit(event, payload);

    return true;
  }

  /**
   * User joins the chat room for an order.
   */
  @SubscribeMessage('join-chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() orderId: string,
  ) {
    const { id: userId, role } = client.data.user;

    const hasAccess = await this.chatService.validateChatAccess(
      orderId,
      userId,
      role,
    );

    if (!hasAccess) {
      throw new WsException('Unauthorized');
    }

    const room = `chat:${orderId}`;

    client.join(room);

    this.logger.log(`User ${userId} joined ${room}`);

    client.emit('joined', {
      orderId,
    });
  }

  /**
   * Send a chat message.
   */
  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      message: string;
      type?: string;
    },
  ) {
    const { id: userId, role } = client.data.user;

    const room = `chat:${data.orderId}`;

    const saved = await this.chatService.saveMessage({
      orderId: data.orderId,
      senderId: userId,
      senderRole: role,
      message: data.message,
      type: data.type ?? 'TEXT',
    });

    this.server.to(room).emit('new-message', {
      orderId: data.orderId,
      message: saved,
    });

    await this.chatService.sendPushIfOffline(saved);
  }

  /**
   * Mark a message as read.
   */
  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      messageId: string;
    },
  ) {
    const { id: userId } = client.data.user;

    await this.chatService.markMessageAsRead(
      data.messageId,
      userId,
    );

    this.server.to(`chat:${data.orderId}`).emit('message-read', {
      messageId: data.messageId,
      userId,
    });
  }

  /**
   * Typing indicator.
   */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      isTyping: boolean;
    },
  ) {
    client.to(`chat:${data.orderId}`).emit('user-typing', {
      userId: client.data.user.id,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('edit-message')
  async handleEditMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string; messageId: string; newMessage: string },
  ) {
    const userId = client.data.user.id;
    const updated = await this.chatService.editMessage(data.messageId, userId, data.newMessage);
    this.server.to(`chat:${data.orderId}`).emit('message-edited', {
      messageId: updated.id,
      newMessage: updated.message,
      editedAt: updated.editedAt,
      editedBy: userId,
    });
  }

  /**
   * Delete a message.
   */
  @SubscribeMessage('delete-message')
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      messageId: string;
    },
  ) {
    const { id: userId, role } = client.data.user;

    await this.chatService.deleteMessage(
      data.messageId,
      userId,
      role,
    );

    this.server.to(`chat:${data.orderId}`).emit('message-deleted', {
      messageId: data.messageId,
      deletedBy: userId,
    });
  }
}