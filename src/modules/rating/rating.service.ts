// rating.service.ts
import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role, RatingStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from 'src/shared/services/prisma.service';
import { PushNotificationService } from '../notification/push-notification.service';

@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationService,
    @InjectQueue('rating-reminders') private reminderQueue: Queue, // BullMQ queue
  ) {}

  // -------------------------------------------------------------------------
  // 1. CREATE RATING REQUEST (called after delivery)
  // -------------------------------------------------------------------------
  async createRatingRequest(
    orderId: string,
    reviewerId: string,
    reviewerRole: Role,
    subjectId: string, // driver
  ): Promise<void> {
    // Idempotency: check existing
    this.logger.debug(`Creating rating request for order ${orderId}, reviewer ${reviewerId}`);
    const existing = await this.prisma.rating.findUnique({
      where: {
        orderId_reviewerId_reviewerRole: {
          orderId,
          reviewerId,
          reviewerRole,
        },
      },
    });
    if (existing) {
      this.logger.debug(`Rating already exists for order ${orderId}, reviewer ${reviewerId}`);
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7‑day window

    this.logger.debug(`Creating rating for order ${orderId}, reviewer ${reviewerId}`);
    const rating = await this.prisma.rating.create({
      data: {
        orderId,
        subjectId,
        reviewerId,
        reviewerRole,
        status: 'PENDING',
        expiresAt,
        reminderCount: 0,
      },
    });

    // Send initial notification (push + in‑app)
    await this.notifyRatingRequest(reviewerId, orderId, reviewerRole);

    // Schedule first reminder after 2 days (delayed job)
    await this.scheduleReminder(rating.id, 2); // 2 days from now

    this.logger.log(`Rating request created for order ${orderId}, reviewer ${reviewerId}`);
  }

  // -------------------------------------------------------------------------
  // 2. NOTIFY RATING REQUEST (push + in‑app)
  // -------------------------------------------------------------------------
  async notifyRatingRequest(reviewerId: string, orderId: string, reviewerRole: Role): Promise<void> {
    try {
        this.logger.debug(`Notifying reviewer ${reviewerId} for order ${orderId}`);
      // 1) In‑app notification
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { orderNumber: true },
      });
      if (!order) {
        this.logger.warn(`Order ${orderId} not found for notification`);
        return;
      }

      const title = this.getNotificationTitle(reviewerRole);
      const body = this.getNotificationBody(reviewerRole, order.orderNumber);

      await this.prisma.notification.create({
        data: {
          userId: reviewerId,
          type: 'RATING_REQUEST',
          title,
          body,
          data: { orderId, orderNumber: order.orderNumber, reviewerRole },
        },
      });

      // 2) Push notification (if user has FCM token)
      this.logger.debug(`Sending push notification to reviewer ${reviewerId} for order ${orderId}`);
      const user = await this.prisma.user.findUnique({
        where: { id: reviewerId },
        select: { fcmToken: true },
      });

      if (user?.fcmToken) {
        await this.pushService.sendToUser(user.fcmToken, {
          title,
          body,
          data: { orderId, orderNumber: order.orderNumber, type: 'RATING_REQUEST' },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to notify reviewer ${reviewerId} for order ${orderId}`, error);
      // We don't throw to avoid blocking the main flow
    }
  }

  // -------------------------------------------------------------------------
  // 3. SCHEDULE REMINDER (using BullMQ delayed job)
  // -------------------------------------------------------------------------
  async scheduleReminder(ratingId: string, daysDelay: number): Promise<void> {
    this.logger.debug(`Scheduling reminder for rating ${ratingId} in ${daysDelay} day(s)`);
    const delayMs = daysDelay * 24 * 60 * 60 * 1000;
    await this.reminderQueue.add(
      'send-reminder',
      { ratingId },
      { delay: delayMs, jobId: `reminder-${ratingId}` }, // deduplicate
    );
    this.logger.debug(`Scheduled reminder for rating ${ratingId} in ${daysDelay} day(s)`);
  }

  // -------------------------------------------------------------------------
  // 4. PROCESS REMINDER (BullMQ worker)
  // -------------------------------------------------------------------------
  async processReminder(job: { data: { ratingId: string } }): Promise<void> {
    this.logger.debug(`Processing reminder job for rating ${job.data.ratingId}`);
    const { ratingId } = job.data;
    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
      include: { order: { select: { orderNumber: true } } },
    });

    if (!rating || rating.status !== 'PENDING') {
      this.logger.debug(`Rating ${ratingId} no longer pending or not found`);
      return;
    }

    // Max 2 reminders
    if (rating.reminderCount >= 2) {
      this.logger.debug(`Rating ${ratingId} already reminded ${rating.reminderCount} times`);
      return;
    }

    // Send reminder notification
    await this.notifyRatingRequest(rating.reviewerId, rating.orderId, rating.reviewerRole);

    // Increment reminder count
    await this.prisma.rating.update({
      where: { id: ratingId },
      data: { reminderCount: { increment: 1 } },
    });

    // Schedule next reminder if less than 2 reminders sent
    if (rating.reminderCount + 1 < 2) {
      await this.scheduleReminder(ratingId, 2); // another reminder after 2 days
    }

    this.logger.log(`Reminder sent for rating ${ratingId}`);
  }

  // -------------------------------------------------------------------------
  // 5. CRON JOB: EXPIRE OLD PENDING RATINGS (runs daily)
  // -------------------------------------------------------------------------
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expirePendingRatings(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.rating.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });
    if (expired.count > 0) {
      this.logger.log(`Expired ${expired.count} pending ratings`);
    }
  }

  // -------------------------------------------------------------------------
  // 6. SUBMIT RATING (endpoint)
  // -------------------------------------------------------------------------
  async submitRating(
    ratingId: string,
    reviewerId: string,
    ratingValue: number,
    comment?: string,
  ): Promise<{ success: boolean }> {
    if (ratingValue < 1 || ratingValue > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
      include: { order: true },
    });

    if (!rating) throw new NotFoundException('Rating request not found');
    if (rating.reviewerId !== reviewerId) {
      throw new ForbiddenException('You are not authorized to rate this order');
    }
    if (rating.status !== 'PENDING') {
      throw new BadRequestException(`Rating is already ${rating.status}`);
    }
    if (new Date() > rating.expiresAt) {
      await this.prisma.rating.update({
        where: { id: ratingId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Rating window has expired');
    }

    // Transaction: update rating and driver's average
    await this.prisma.$transaction(async (tx) => {
        this.logger.debug(`Submitting rating ${ratingId} by reviewer ${reviewerId} with value ${ratingValue}`);
      await tx.rating.update({
        where: { id: ratingId },
        data: {
          rating: ratingValue,
          comment,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      const driverProfile = await tx.driverProfile.findUnique({
        where: { userId: rating.subjectId },
        select: { rating: true, ratingCount: true },
      });
      if (driverProfile) {
        this.logger.debug(`Updating driver ${rating.subjectId} average rating with new value ${ratingValue}`);
        const oldTotal = (driverProfile.rating ?? 0) * driverProfile.ratingCount;
        const newCount = driverProfile.ratingCount + 1;
        const newAverage = (oldTotal + ratingValue) / newCount;
        await tx.driverProfile.update({
          where: { userId: rating.subjectId },
          data: {
            rating: newAverage,
            ratingCount: newCount,
          },
        });
      }
    });

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------------------------
  private getNotificationTitle(role: Role): string {
    switch (role) {
      case Role.CUSTOMER:
        return 'Rate Your Delivery';
      case Role.VENDOR:
        return 'Rate Your Delivery Driver';
      default:
        return 'Rate Your Experience';
    }
  }

  private getNotificationBody(role: Role, orderNumber: string): string {
    switch (role) {
      case Role.CUSTOMER:
        return `How was your delivery for order #${orderNumber}? Tap to rate.`;
      case Role.VENDOR:
        return `How was the driver for order #${orderNumber}? Tap to rate.`;
      default:
        return `Please rate your experience for order #${orderNumber}.`;
    }
  }
}