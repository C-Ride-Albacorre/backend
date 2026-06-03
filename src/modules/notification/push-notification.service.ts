import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../../shared/services/prisma.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  sound?: string;
  priority?: 'normal' | 'high';
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private isEnabled: boolean;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.isEnabled =
      this.configService.get('PUSH_NOTIFICATIONS_ENABLED') === 'true';
    if (this.isEnabled && !admin.apps.length) {
      this.initializeFirebase();
    } else if (!this.isEnabled) {
      this.logger.warn(
        'Push notifications are disabled (PUSH_NOTIFICATIONS_ENABLED=false)',
      );
    }
  }

  private initializeFirebase(): void {
    try {
      const projectId = this.configService.get('FIREBASE_PROJECT_ID');
      const privateKey = this.configService
        .get('FIREBASE_PRIVATE_KEY')
        ?.replace(/\\n/g, '\n');
      const clientEmail = this.configService.get('FIREBASE_CLIENT_EMAIL');

      if (!projectId || !privateKey || !clientEmail) {
        throw new Error('Missing Firebase credentials in environment');
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey,
          clientEmail,
        }),
      });
      this.logger.log('Firebase Admin SDK initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
      this.isEnabled = false; // fallback
    }
  }

  

  /**
   * Send push notification to a single driver (or any user with a token).
   */
  async sendToDriver(
    driverId: string,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    if (!this.isEnabled) {
      this.logger.debug(
        `Push disabled – would send to driver ${driverId}: ${payload.title}`,
      );
      return false;
    }

    try {
      // Fetch driver's FCM token from database
      // const driver = await this.prisma.driverProfile.findUnique({
      //   where: { userId: driverId },
      //   select: { fcmToken: true, deviceType: true },
      // });
      // if (!driver?.fcmToken) {
      //   this.logger.warn(`Driver ${driverId} has no FCM token`);
      //   return false;
      // }
      // Fetch driver's FCM token from User table
        const driver = await this.prisma.user.findUnique({
          where: { id: driverId },
          select: {
            fcmToken: true,
            deviceType: true,
          },
        });

        if (!driver?.fcmToken) {
          this.logger.warn(`Driver ${driverId} has no FCM token`);
          return false;
        }

      const message: admin.messaging.Message = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data || {},
        android: {
          priority: payload.priority === 'high' ? 'high' : 'normal',
          notification: {
            sound: payload.sound || 'default',
            channelId: 'delivery_requests',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: payload.sound || 'default',
              badge: 1,
            },
          },
        },
        token: driver.fcmToken,
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Push sent to driver ${driverId}: ${response}`);
      return true;
    } catch (error) {
      // Handle invalid token (e.g., uninstalled app)
      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered'
      ) {
        this.logger.warn(
          `Invalid FCM token for driver ${driverId}, removing from DB`,
        );
        // await this.prisma.driverProfile
        //   .update({
        //     where: { userId: driverId },
        //     data: { fcmToken: null },
        //   })
          await this.prisma.user
          .update({
            where: { id: driverId },
            data: { fcmToken: null },
          })
          .catch((e) => this.logger.error(e));
      } else {
        this.logger.error(
          `Failed to send push to driver ${driverId}: ${error.message}`,
          error.stack,
        );
      }
      return false;
    }
  }

  /**
   * Send push notification to a customer.
   */
  async sendToCustomer(
    userId: string,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    if (!this.isEnabled) return false;

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmToken: true },
      });
      if (!user?.fcmToken) return false;

      const message: admin.messaging.Message = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data || {},
        token: user.fcmToken,
      };
      await admin.messaging().send(message);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send push to customer ${userId}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Send to multiple devices (max 500 tokens per batch).
   */
  async sendToMultiple(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<{ success: number; failure: number }> {
    if (!this.isEnabled || tokens.length === 0)
      return { success: 0, failure: 0 };

    // FCM batch send: max 500 tokens per call
    const batchSize = 500;
    let success = 0;
    let failure = 0;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const message: admin.messaging.MulticastMessage = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data || {},
        tokens: batch,
      };
      try {
        const response = await admin.messaging().sendEachForMulticast(message);
        success += response.successCount;
        failure += response.failureCount;
        // Optionally log failed tokens
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            this.logger.warn(
              `Failed token ${batch[idx]}: ${resp.error?.message}`,
            );
          }
        });
      } catch (error) {
        this.logger.error(
          `Multicast send failed for batch starting at ${i}`,
          error.stack,
        );
        failure += batch.length;
      }
    }
    return { success, failure };
  }

  async registerToken(userId: string, token: string, deviceType?: string) {
  await this.prisma.user.update({
    where: { id: userId },
    data: { fcmToken: token, deviceType },
  });
  this.logger.log(`Registered FCM token for user ${userId}`);
}


async unregisterToken(userId: string) {
  await this.prisma.user.update({
    where: { id: userId },
    data: { fcmToken: null },
  });
  this.logger.log(`Unregistered FCM token for user ${userId}`);
}

  /**
   * Store or update a driver's FCM token.
   */
//   async registerDriverToken(
//     driverId: string,
//     token: string,
//     deviceType?: string,
//   ): Promise<void> {
//     await this.prisma.driverProfile.update({
//       where: { userId: driverId },
//       data: { fcmToken: token, deviceType },
//     });
//     this.logger.log(`Registered FCM token for driver ${driverId}`);
//   }

//   /**
//    * Remove token (e.g., on logout or app uninstall).
//    */
//   async unregisterDriverToken(driverId: string): Promise<void> {
//     await this.prisma.driverProfile.update({
//       where: { userId: driverId },
//       data: { fcmToken: null },
//     });
//     this.logger.log(`Unregistered FCM token for driver ${driverId}`);
//   }

//   // push-notification.service.ts
// async registerCustomerToken(userId: string, token: string, deviceType?: string,
// ): Promise<void> {
//   await this.prisma.user.update({
//     where: { id: userId },
//     data: { fcmToken: token, deviceType },
//   });
//   this.logger.log(`Registered FCM token for customer ${userId}`);
// }
}
