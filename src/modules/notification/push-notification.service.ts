
import { Injectable, Logger } from '@nestjs/common';
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
    const raw = this.configService.get<string>('PUSH_NOTIFICATIONS_ENABLED');

    this.isEnabled = PushNotificationService.parseBool(raw);

    this.logger.log(
      `[boot] PUSH_NOTIFICATIONS_ENABLED raw=${JSON.stringify(raw)} → isEnabled=${this.isEnabled}`,
    );

    if (this.isEnabled) {
      if (!admin.apps.length) {
        this.initializeFirebase();
      }
      this.logger.log('[boot] Firebase app ready');
    } else {
      this.logger.warn(
        '[boot] Push notifications are DISABLED (PUSH_NOTIFICATIONS_ENABLED != "true")',
      );
    }
  }

  private static parseBool(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return false;
    const v = raw.trim().replace(/^["']|["']$/g, '').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'on';
  }

  private initializeFirebase(): void {
    const base64 = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    if (!base64) {
      // Do not silently disable. Make it loud.
      throw new Error(
        '[boot] FIREBASE_PRIVATE_KEY is not set — push cannot work. ' +
        'Set it in Render → Environment as Base64 of the full service-account JSON.',
      );
    }

    let serviceAccount: any;
    try {
      const decoded = Buffer.from(base64, 'base64').toString('utf-8');
      serviceAccount = JSON.parse(decoded);
    } catch (e: any) {
      throw new Error(
        `[boot] FIREBASE_PRIVATE_KEY is not valid Base64-encoded JSON: ${e?.message}`,
      );
    }

    if (
      !serviceAccount.project_id ||
      !serviceAccount.private_key ||
      !serviceAccount.client_email
    ) {
      throw new Error(
        '[boot] Service account JSON is missing project_id / private_key / client_email',
      );
    }

    // Normalize PEM line breaks
    serviceAccount.private_key = String(serviceAccount.private_key)
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
      .concat('\n');

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

    this.logger.log(
      `[boot] Firebase Admin SDK initialized project_id=${serviceAccount.project_id} ` +
      `client_email=${serviceAccount.client_email}`,
    );
  }


  
private async sendPushNotification(
  userId: string,
  recipientType: string,
  payload: PushNotificationPayload,
  channelId = 'general',
): Promise<boolean> {
  this.logger.log(
    `[sendPushNotification] enter ${recipientType}=${userId} enabled=${this.isEnabled}`,
  );

  if (!this.isEnabled) {
    this.logger.warn(
      `[sendPushNotification] DISABLED – would send "${payload.title}" to ${recipientType} ${userId}`,
    );
    return false;
  }

  try {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) {
      this.logger.warn(
        `${recipientType} ${userId} has no FCM token`,
      );
      return false;
    }

    // FCM requires every data value to be a string
    const data: Record<string, string> = Object.fromEntries(
      Object.entries(payload.data ?? {}).map(([k, v]) => [
        k,
        String(v),
      ]),
    );

    const message: admin.messaging.Message = {
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId,
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          priority: 'max',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            sound: payload.sound || 'default',
            badge: 1,
          },
        },
      },
      token: user.fcmToken,
    };

    this.logger.log(
      `Sending push to ${recipientType} ${userId} token=${user.fcmToken} msg=${JSON.stringify(message)}`,
    );

    const response = await admin.messaging().send(message);

    this.logger.log(
      `Push OK ${recipientType} ${userId} messageId=${response}`,
    );

    return true;
  } catch (error: any) {
    const code: string | undefined = error?.code;

    const tokenErrors = new Set([
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/unregistered',
      'messaging/mismatched-credential',
    ]);

    this.logger.error(
      `Push FAILED ${recipientType} ${userId} code=${code ?? 'unknown'} error=${error?.message ?? error}`,
      error,
    );

    if (code && tokenErrors.has(code)) {
      await this.prisma.user
        .update({
          where: { id: userId },
          data: { fcmToken: null },
        })
        .catch((e) => this.logger.error(e));
    }

    return false;
  }
}



async sendToUser(
  userId: string,
  payload: PushNotificationPayload,
): Promise<boolean> {
  return this.sendPushNotification(
    userId,
    'user',
    payload,
    'delivery_requests_v2', //general
  );
}

async sendToCustomer(
  userId: string,
  payload: PushNotificationPayload,
): Promise<boolean> {
  return this.sendPushNotification(
    userId,
    'customer',
    payload,
    'delivery_requests_v2',
  );
}

async sendToDriver(
  driverId: string,
  payload: PushNotificationPayload,
): Promise<boolean> {
  return this.sendPushNotification(
    driverId,
    'driver',
    payload,
    'vendor_orders_v1',
  );
}

async sendToVendor(
  vendorId: string,
  payload: PushNotificationPayload,
): Promise<boolean> {
  return this.sendPushNotification(
    vendorId,
    'vendor',
    payload,
    'delivery_requests_v2',
  );
}



  async sendToDriverOld(
    driverId: string,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    this.logger.log(
      `[sendToDriver] enter driver=${driverId} enabled=${this.isEnabled}`,
    );

    if (!this.isEnabled) {
      this.logger.warn(
        `[sendToDriver] DISABLED – would send "${payload.title}" to ${driverId}`,
      );
      return false;
    }

    try {
      const driver = await this.prisma.user.findUnique({
        where: { id: driverId },
        select: { fcmToken: true, deviceType: true },
      });

      if (!driver?.fcmToken) {
        this.logger.warn(`Driver ${driverId} has no FCM token`);
        return false;
      }

      // FCM requires every data value to be a string
      const data: Record<string, string> = Object.fromEntries(
        Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)]),
      );

      const message: admin.messaging.Message = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'delivery_requests_v2',
            sound: 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: 'max',
          },
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: {
            aps: {
              sound: payload.sound || 'default',
              badge: 1,
            },
          },
        },
        token: driver.fcmToken,
      };

      this.logger.log(
        `Sending push to driver ${driverId} token=${driver.fcmToken} msg=${JSON.stringify(message)}`,
      );

      const response = await admin.messaging().send(message);
      this.logger.log(`Push OK driver ${driverId} messageId=${response}`);
      return true;
    } catch (error: any) {
      const code: string | undefined = error?.code;
      const knownTokenErrors = new Set([
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered',
        'messaging/unregistered',
        'messaging/mismatched-credential',
      ]);

      this.logger.error(
        `Push FAILED driver ${driverId} code=${code ?? 'unknown'} error=${error?.message ?? error}`,
        error,
      );

      if (code && knownTokenErrors.has(code)) {
        await this.prisma.user
          .update({ where: { id: driverId }, data: { fcmToken: null } })
          .catch((e) => this.logger.error(e));
      }
      return false;
    }
  }
  /**
   * Send push notification to a customer.
   */

async sendToCustomerOld(
  userId: string,
  payload: PushNotificationPayload,
): Promise<boolean> {
  this.logger.log(
    `[sendToCustomer] enter user=${userId} enabled=${this.isEnabled}`,
  );

  if (!this.isEnabled) {
    this.logger.warn(
      `[sendToCustomer] DISABLED – would send "${payload.title}" to ${userId}`,
    );
    return false;
  }

  try {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, deviceType: true },
    });

    if (!user?.fcmToken) {
      this.logger.warn(`Customer ${userId} has no FCM token`);
      return false;
    }

    // FCM requires every data value to be a string
    const data: Record<string, string> = Object.fromEntries(
      Object.entries(payload.data ?? {}).map(([k, v]) => [
        k,
        String(v),
      ]),
    );

    const message: admin.messaging.Message = {
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'delivery_requests_v2',
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          priority: 'max',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            sound: payload.sound || 'default',
            badge: 1,
          },
        },
      },
      token: user.fcmToken,
    };

    this.logger.log(
      `Sending push to customer ${userId} token=${user.fcmToken} msg=${JSON.stringify(message)}`,
    );

    const response = await admin.messaging().send(message);

    this.logger.log(
      `Push OK customer ${userId} messageId=${response}`,
    );

    return true;
  } catch (error: any) {
    const code: string | undefined = error?.code;

    const knownTokenErrors = new Set([
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/unregistered',
      'messaging/mismatched-credential',
    ]);

    this.logger.error(
      `Push FAILED customer ${userId} code=${code ?? 'unknown'} error=${error?.message ?? error}`,
      error,
    );

    if (code && knownTokenErrors.has(code)) {
      await this.prisma.user
        .update({
          where: { id: userId },
          data: { fcmToken: null },
        })
        .catch((e) => this.logger.error(e));
    }

    return false;
  }
}


async sendToUserOld(
  userId: string,
  payload: PushNotificationPayload,
): Promise<boolean> {
  this.logger.log(`[sendToUser] enter userId=${userId} enabled=${this.isEnabled}`);
  if (!this.isEnabled) {
    this.logger.warn(`[sendToUser] DISABLED – would send "${payload.title}" to ${userId}`);
    return false;
  }

  try {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });
    if (!user?.fcmToken) {
      this.logger.warn(`User ${userId} has no FCM token`);
      return false;
    }

    const data: Record<string, string> = Object.fromEntries(
      Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)]),
    );

    const message: admin.messaging.Message = {
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'general',      // ← app must create this channel at IMPORTANCE_HIGH
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          priority: 'max',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: payload.sound || 'default', badge: 1 } },
      },
      token: user.fcmToken,
    };

    this.logger.log(`Sending push to user ${userId} token=${user.fcmToken} msg=${JSON.stringify(message)}`);
    const response = await admin.messaging().send(message);
    this.logger.log(`Push OK user ${userId} messageId=${response}`);
    return true;
  } catch (error: any) {
    const code: string | undefined = error?.code;
    const tokenErrors = new Set([
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/unregistered',
      'messaging/mismatched-credential',
    ]);
    this.logger.error(
      `Push FAILED user ${userId} code=${code ?? 'unknown'} error=${error?.message ?? error}`,
      error,
    );
    if (code && tokenErrors.has(code)) {
      await this.prisma.user
        .update({ where: { id: userId }, data: { fcmToken: null } })
        .catch((e) => this.logger.error(e));
    }
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
          error,
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


async sendPickupPush(
  userId: string,
  orderId: string,
  driverName?: string,
): Promise<boolean> {
  return this.sendToCustomer(userId, {
    title: 'Order Picked Up',
    body: driverName
      ? `${driverName} has picked up your order #${orderId}.`
      : `Your order #${orderId} has been picked up.`,
    data: {
      orderId,
      type: 'PICKUP',
    },
    priority: 'high',
  });
}







}