import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { PushNotificationService } from '../notification/push-notification.service';
import { ChatMessage, MessageType, Role } from '@prisma/client';
import { CloudinaryService } from 'src/shared/services/cloudinary.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationService,
    private cloudinaryService: CloudinaryService,
  ) { }

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
     where: { orderId, deletedAt: null },
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


  /**
   * Upload an image to Cloudinary and return the URL.
   * Automatically sends a message of type IMAGE.
   */
  async uploadImage(
    orderId: string,
    senderId: string,
    senderRole: Role,
    file: Express.Multer.File,
  ): Promise<{ imageUrl: string; message: ChatMessage }> {
    // Validate access
    const canAccess = await this.validateChatAccess(orderId, senderId, senderRole);
    if (!canAccess) throw new ForbiddenException('You do not have access to this chat');

    // Validate file
    if (!file) throw new BadRequestException('No file uploaded');
    const allowedMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'];
    if (!allowedMime.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed');
    }
    if (file.size > 5 * 1024 * 1024) { // 5MB
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    // Upload to Cloudinary
    const result = await this.cloudinaryService.uploadFile(file, `chat/${orderId}`);
    const imageUrl = result.secure_url;

    // Save as a message with type IMAGE
    const savedMessage = await this.prisma.chatMessage.create({
      data: {
        orderId,
        senderId,
        senderRole,
        message: imageUrl, // store the URL in the message field
        type: 'IMAGE',
      },
    });

    return { imageUrl, message: savedMessage };
  }

  // chat.service.ts
  async deleteMessage(messageId: string, userId: string, role: Role): Promise<void> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { order: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    // Only the sender can delete their own message
    if (message.senderId !== userId) throw new ForbiddenException('You can only delete your own messages');
    // Soft delete
    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
  }
}