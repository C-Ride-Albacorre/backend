// src/modules/call/call.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { PushNotificationService } from '../notification/push-notification.service';
import { AgoraTokenService } from './provider/agora-token.service';
import { CallStatus, Role, Call, CallParticipant } from '@prisma/client';
import { RtcRole } from 'agora-access-token';

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationService,
    private agoraTokenService: AgoraTokenService,
  ) {}

  /**
   * Validate that a user has access to a given order (same logic as chat).
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
   * Returns call object, Agora token, channel name, and app ID.
   */
  async initiateCall(
    orderId: string,
    initiatorId: string,
    initiatorRole: Role,
  ): Promise<{ call: Call; token: string; channelName: string; appId: string }> {
    // 1. Validate access
    const canAccess = await this.validateCallAccess(orderId, initiatorId, initiatorRole);
    if (!canAccess) {
      throw new ForbiddenException('You are not authorized to call regarding this order');
    }

    // 2. Check for an existing active call for this order
    const activeCall = await this.prisma.call.findFirst({
      where: {
        orderId,
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.CONNECTED] },
      },
    });
    if (activeCall) {
      throw new BadRequestException('There is already an active call for this order');
    }

    // 3. Fetch the order and determine the recipient (the other party)
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        driverAssignment: true,
        user: { select: { id: true, fcmToken: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    let recipientId: string | undefined;
    let recipientRole: Role;
    if (initiatorRole === Role.CUSTOMER) {
      recipientId = order.driverAssignment?.driverId;
      recipientRole = Role.DISPATCHER; // assuming driver has DISPATCHER role in your system
    } else {
      recipientId = order.userId;
      recipientRole = Role.CUSTOMER;
    }
    if (!recipientId) {
      throw new BadRequestException('Recipient not found for this order');
    }

    // 4. Create the call record with participants
    const call = await this.prisma.call.create({
      data: {
        orderId,
        initiatedBy: initiatorId,
        status: CallStatus.INITIATED,
        participants: {
          create: [
            { userId: initiatorId, role: initiatorRole },
            { userId: recipientId, role: recipientRole },
          ],
        },
      },
      include: { participants: true },
    });

    // 5. Generate Agora channel name and tokens
    const channelName = `call-${call.id}`;
    const initiatorToken = this.agoraTokenService.generateToken(
      initiatorId,
      channelName,
      RtcRole.PUBLISHER,
    );

    // 6. Update call status to RINGING
    await this.prisma.call.update({
      where: { id: call.id },
      data: { status: CallStatus.RINGING },
    });

    // 7. Send push notification to the recipient
    await this.pushService.sendToUser(recipientId, {
      title: 'Incoming Call',
      body: `You have an incoming call regarding order #${orderId.slice(0, 8)}`,
      data: {
        type: 'incoming_call',
        callId: call.id,
        orderId,
        channelName,
        callerId: initiatorId,
        callerRole: initiatorRole,
        appId: this.agoraTokenService.appId, // expose appId for client
        // Optionally, send a temporary token for the recipient if you want them to join without hitting accept endpoint.
        // But we prefer to generate a fresh token on accept for security.
      },
      
      // For iOS/Android, consider setting priority high, sound, etc.
    });

    this.logger.log(`Call ${call.id} initiated by ${initiatorId} for order ${orderId}`);

    return {
      call,
      token: initiatorToken,
      channelName,
      appId: this.agoraTokenService.appId,
    };
  }

  /**
   * Accept an incoming call.
   * Returns a new Agora token for the accepting user.
   */
  async acceptCall(
    callId: string,
    userId: string,
  ): Promise<{ token: string; channelName: string; appId: string }> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) {
      throw new NotFoundException('Call not found');
    }
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException('Call is not in ringing state');
    }

    // Check if user is a participant
    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException('You are not a participant of this call');
    }

    // Generate token for the accepting user
    const channelName = `call-${callId}`;
    const token = this.agoraTokenService.generateToken(
      userId,
      channelName,
      RtcRole.PUBLISHER,
    );

    // Update call status to CONNECTED and set startedAt
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.CONNECTED,
        startedAt: new Date(),
      },
    });

    // Optionally notify the caller via WebSocket or push that the call was accepted
    // You can use your WebSocket gateway here if available.
    // For now, we'll just log.
    this.logger.log(`Call ${callId} accepted by ${userId}`);

    return { token, channelName, appId: this.agoraTokenService.appId };
  }

  /**
   * Reject a call.
   */
  async rejectCall(callId: string, userId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) {
      throw new NotFoundException('Call not found');
    }
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException('Call is not in ringing state');
    }

    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException('You are not a participant of this call');
    }

    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.REJECTED,
        endedAt: new Date(),
      },
    });

    // Notify the other participant (e.g., via WebSocket)
    this.logger.log(`Call ${callId} rejected by ${userId}`);
  }

  /**
   * End an ongoing call.
   */
  async endCall(callId: string, userId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) {
      throw new NotFoundException('Call not found');
    }
    if (call.status !== CallStatus.CONNECTED) {
      throw new BadRequestException('Call is not connected');
    }

    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException('You are not a participant of this call');
    }

    // Calculate duration in seconds
    let duration = 0;
    if (call.startedAt) {
      duration = Math.floor((new Date().getTime() - call.startedAt.getTime()) / 1000);
    }

    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.COMPLETED,
        endedAt: new Date(),
        duration,
      },
    });

    // Notify the other participant (e.g., via WebSocket)
    this.logger.log(`Call ${callId} ended by ${userId}, duration ${duration}s`);
  }

  /**
   * Get call history for a user, optionally filtered by order.
   */
  async getCallHistory(userId: string, orderId?: string): Promise<Call[]> {
    return this.prisma.call.findMany({
      where: {
        ...(orderId && { orderId }),
        participants: { some: { userId } },
      },
      include: {
        participants: true,
        order: {
          select: {
            id: true,
            // Add more order fields if needed
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get the currently active call for an order (if any).
   */
  async getActiveCall(orderId: string): Promise<Call | null> {
    return this.prisma.call.findFirst({
      where: {
        orderId,
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.CONNECTED] },
      },
      include: { participants: true },
    });
  }
}