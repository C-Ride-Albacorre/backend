import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { PushNotificationService } from '../notification/push-notification.service';
import { ChatMessage, MessageType, Role } from '@prisma/client';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationService,
  ) {}

  async validateChatAccess(orderId: string, userId: string, role: Role): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { driverAssignment: true },
    });
    if (!order) return false;
    if (role === Role.CUSTOMER && order.userId === userId) return true;
    if (role === Role.DISPATCHER && order.driverAssignment?.driverId === userId) return true;
    return false;
  }

  async saveMessage(data: {
    orderId: string;
    senderId: string;
    senderRole: Role;
    message: string;
    type?: string;
  }): Promise<ChatMessage> {
    return this.prisma.chatMessage.create({
      data: {
        orderId: data.orderId,
        senderId: data.senderId,
        senderRole: data.senderRole,
        message: data.message,
        type: data.type as MessageType || 'TEXT',
      },
    });
  }

  async getMessages(orderId: string, userId: string, role: Role): Promise<ChatMessage[]> {
    const canAccess = await this.validateChatAccess(orderId, userId, role);
    if (!canAccess) throw new ForbiddenException();
    return this.prisma.chatMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { order: true },
    });
    if (!message) throw new NotFoundException();
    // Only recipient (non‑sender) can mark as read
    if (message.senderId === userId) return;
    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async sendPushIfOffline(message: ChatMessage): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: message.orderId },
      include: { driverAssignment: true, user: { select: { id: true, fcmToken: true } } },
    });
    const recipientId = message.senderRole === Role.CUSTOMER
      ? order.driverAssignment?.driverId
      : order.userId;
    if (!recipientId) return;

    // Check if recipient is online via WebSocket (optional: store socketIds in Redis)
    // For simplicity, we always send push – mobile will deduplicate if app is in foreground.
    const title = message.senderRole === Role.CUSTOMER ? 'CUSTOMER' : 'DISPATCHER';
    await this.pushService.sendToUser(recipientId, {
      title: `New message from ${title}`,
      body: message.message.length > 100 ? message.message.slice(0, 97) + '...' : message.message,
      data: { orderId: message.orderId, type: 'chat' },
    });
  }
}