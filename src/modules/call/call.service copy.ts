// import { Injectable } from '@nestjs/common';

// @Injectable()
// export class CallService {}
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { PushNotificationService } from '../notification/push-notification.service';
import { CallStatus, Role } from '@prisma/client';

// Interface for a VoIP provider (e.g., Twilio, Agora)
export interface IVoipProvider {
  generateToken(userId: string, roomName: string): Promise<string>;
  createRoom?(roomName: string): Promise<any>;
}

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationService,
    private voipProvider: IVoipProvider, // inject your provider implementation
  ) {}

  /**
   * Validate that a user is allowed to call regarding a specific order.
   * Same logic as in ChatService.validateChatAccess.
   */
  async validateCallAccess(orderId: string, userId: string, role: Role): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { driverAssignment: true },
    });
    if (!order) return false;
    if (role === Role.CUSTOMER && order.userId === userId) return true;
    if (role === Role.DISPATCHER && order.driverAssignment?.driverId === userId) return true;
    return false;
  }

  /**
   * Initiate a new call.
   * Returns a call object and a VoIP token for the caller.
   */
  async initiateCall(
    orderId: string,
    initiatorId: string,
    initiatorRole: Role,
  ): Promise<{ call: any; token: string; roomName: string }> {
    // 1. Validate access
    const canAccess = await this.validateCallAccess(orderId, initiatorId, initiatorRole);
    if (!canAccess) throw new ForbiddenException('You are not authorized to call regarding this order');

    // 2. Check if there is already an active call for this order
    const activeCall = await this.prisma.call.findFirst({
      where: {
        orderId,
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.CONNECTED] },
      },
    });
    if (activeCall) {
      throw new BadRequestException('There is already an active call for this order');
    }

    // 3. Determine the recipient (the other party)
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { driverAssignment: true, user: { select: { id: true, fcmToken: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const recipientId =
      initiatorRole === Role.CUSTOMER
        ? order.driverAssignment?.driverId
        : order.userId;
    if (!recipientId) throw new BadRequestException('Recipient not found for this order');

    // 4. Create the call record
    const call = await this.prisma.call.create({
      data: {
        orderId,
        initiatedBy: initiatorId,
        status: CallStatus.INITIATED,
        participants: {
          create: [
            { userId: initiatorId, role: initiatorRole },
            { userId: recipientId, role: initiatorRole === Role.CUSTOMER ? Role.DISPATCHER : Role.CUSTOMER },
          ],
        },
      },
      include: { participants: true },
    });

    // 5. Generate a unique room name (use call id)
    const roomName = `call-${call.id}`;

    // 6. Get a VoIP token for the caller (from your provider)
    const token = await this.voipProvider.generateToken(initiatorId, roomName);

    // 7. Send a push notification to the recipient
    await this.pushService.sendToUser(recipientId, {
      title: 'Incoming Call',
      body: `You have an incoming call regarding order #${orderId.slice(0, 8)}`,
      data: {
        type: 'incoming_call',
        callId: call.id,
        orderId,
        roomName,
        callerId: initiatorId,
        callerRole: initiatorRole,
      },
      // optionally set priority high, sound, etc.
    });

    // Update call status to RINGING after push? Or keep INITIATED until recipient accepts.
    // We'll set to RINGING here.
    await this.prisma.call.update({
      where: { id: call.id },
      data: { status: CallStatus.RINGING },
    });

    return { call, token, roomName };
  }

  /**
   * Accept an incoming call.
   * Returns a VoIP token for the recipient so they can join the room.
   */
  async acceptCall(callId: string, userId: string): Promise<{ token: string; roomName: string }> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) throw new NotFoundException('Call not found');
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException('Call is not in ringing state');
    }

    // Check if user is a participant
    const participant = call.participants.find(p => p.userId === userId);
    if (!participant) throw new ForbiddenException('You are not a participant of this call');

    // Update call status to CONNECTED and set startedAt
    const updatedCall = await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.CONNECTED,
        startedAt: new Date(),
      },
    });

    // Generate token for the accepting user
    const roomName = `call-${callId}`;
    const token = await this.voipProvider.generateToken(userId, roomName);

    // Optionally send push to caller that call was accepted (or rely on WebSocket)
    return { token, roomName };
  }

  /**
   * Reject a call.
   */
  async rejectCall(callId: string, userId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) throw new NotFoundException('Call not found');
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException('Call is not in ringing state');
    }
    const participant = call.participants.find(p => p.userId === userId);
    if (!participant) throw new ForbiddenException('You are not a participant');

    await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.REJECTED, endedAt: new Date() },
    });
    // Notify the caller that the call was rejected (push or WS)
  }

  /**
   * End an ongoing call.
   */
  async endCall(callId: string, userId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) throw new NotFoundException('Call not found');
    if (call.status !== CallStatus.CONNECTED) {
      throw new BadRequestException('Call is not connected');
    }
    const participant = call.participants.find(p => p.userId === userId);
    if (!participant) throw new ForbiddenException('You are not a participant');

    const duration = Math.floor((new Date().getTime() - call.startedAt.getTime()) / 1000);
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.COMPLETED,
        endedAt: new Date(),
        duration,
      },
    });
    // Notify other participant that call ended
  }

  /**
   * Get call history for a user (optionally filtered by order).
   */
  async getCallHistory(userId: string, orderId?: string): Promise<any[]> {
    return this.prisma.call.findMany({
      where: {
        ...(orderId && { orderId }),
        participants: { some: { userId } },
      },
      include: { participants: true, order: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get active call for an order (if any).
   */
  async getActiveCall(orderId: string): Promise<any | null> {
    return this.prisma.call.findFirst({
      where: {
        orderId,
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.CONNECTED] },
      },
      include: { participants: true },
    });
  }
}