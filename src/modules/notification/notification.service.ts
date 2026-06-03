import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { NotificationType, Role } from '@prisma/client';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { VendorNotificationGateway } from 'src/common/map-gateway/vendor-notification.gateway';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private zohoEmailProvider: ZohoEmailProvider,
    private vendorGateway: VendorNotificationGateway,
    private pushService: PushNotificationService, // ← inject
  ) { }

  /**
   * Notify all vendors associated with an order that a new order has been placed.
   * Fetches unique vendor IDs from order items (through stores) and sends notifications.
   */
  async notifyVendorsForOrder(orderId: string): Promise<void> {
    try {
      // Fetch order with items and their stores
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              store: {
                select: { userId: true }, // vendor ID
              },
            },
          },
        },
      });

      if (!order) {
        this.logger.warn(`Order ${orderId} not found when notifying vendors`);
        return;
      }

      // Extract unique vendor IDs (store.userId)
      const vendorIds = [
        ...new Set(
          order.items.map((item) => item.store?.userId).filter(Boolean),
        ),
      ];

      if (vendorIds.length === 0) {
        this.logger.warn(`No vendors found for order ${orderId}`);
        return;
      }

      // Send notification to each vendor
      const notificationPromises = vendorIds.map((vendorId) =>
        this.sendVendorOrderPlaced(vendorId, order.id, order.orderNumber),
      );

      await Promise.allSettled(notificationPromises);

      this.logger.log(
        `Notified ${vendorIds.length} vendors for order ${orderId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify vendors for order ${orderId}`,
        error.stack,
      );
      // Do not throw – this is a non‑critical side effect
    }
  }

  async sendVendorOrderPlaced(
    vendorId: string,
    orderId: string,
    orderNumber: string,
  ) {
    await this.prisma.notification.create({
      data: {
        userId: vendorId,
        type: NotificationType.VENDOR_ACTION_REQUIRED,
        title: 'New Order',
        body: `Order #${orderNumber} requires your action`,
        data: { orderId },
      },
    });
    this.vendorGateway.sendToVendor(vendorId, 'order-placed', {
      orderId,
      orderNumber,
    });
    this.logger.log(`Sending order confirmation email for order ${orderNumber} to vendor ${vendorId}`);
    await this.zohoEmailProvider.sendOrderConfirmation(
      await this.getVendorEmail(vendorId),
      'New Order',
      `Order ${orderNumber} has been placed. Please login to accept or decline.`,
    );
  }

  private async getVendorEmail(vendorId: string): Promise<string> {
    const vendor = await this.prisma.user.findFirst({
      where: {
        id: vendorId,
        role: Role.VENDOR,
      },
      select: {
        email: true,
      },
    });

    if (!vendor?.email) {
      throw new NotFoundException(
        `Vendor email not found for vendorId: ${vendorId}`,
      );
    }

    return vendor.email;
  }

  async sendDriverPickupAlert(
    driverId: string,
    orderId: string,
    vendorLocation: any,
  ) {
    // Push notification (FCM/APNS) – integrate with Firebase or similar
    // Also create DB record
  }

  // async sendOrderCancelled(
  //   customerId: string,
  //   orderNumber: string,
  //   reason: string,
  // ) {
  //   // Notify customer
  // }

  /**
   * Send order cancelled notification to customer (used in vendor decline flow).
   */
  // notification.service.ts (partial update)

  // ... other methods ...

  /**
   * Send order cancelled notification to customer (used in vendor decline, no drivers, admin cancel).
   * Sends in-app notification, email, and push notification.
   */
  async sendOrderCancelled(
    customerId: string,
    orderNumber: string,
    reason?: string,
  ): Promise<void> {
    try {
      const body = reason
        ? `Your order #${orderNumber} has been cancelled. Reason: ${reason}`
        : `Your order #${orderNumber} has been cancelled.`;

      // 1. In-app database notification
      await this.prisma.notification.create({
        data: {
          userId: customerId,
          type: NotificationType.ORDER_STATUS,
          title: 'Order Cancelled',
          body,
          data: { orderNumber, reason },
        },
      });

      // 2. Email notification
      const user = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { email: true },
      });
      if (user?.email) {
        await this.zohoEmailProvider.sendEmail(
          user.email,
          `Order #${orderNumber} Cancelled`,
          `<p>${body}</p><p>If you have any questions, please contact support.</p>`,
        );
      }

      // 3. Push notification (mobile)
      await this.pushService.sendToCustomer(customerId, {
        title: 'Order Cancelled',
        body,
        data: { orderId: '?', orderNumber },
        priority: 'high',
      });

      this.logger.log(`Cancellation notifications sent for order ${orderNumber} to customer ${customerId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send order cancelled notification for order ${orderNumber}`,
        error.stack,
      );
      // Non-critical – do not throw
    }
  }
}
