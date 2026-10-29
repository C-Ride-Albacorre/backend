import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { NotificationType, Role } from '@prisma/client';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { VendorNotificationGateway } from '../../common/map-gateway/vendor-notification.gateway';
import { PushNotificationService } from './push-notification.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private zohoEmailProvider: ZohoEmailProvider,
    private vendorGateway: VendorNotificationGateway,
    private pushService: PushNotificationService,
    private config: ConfigService,

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
        error,
      );
      // Do not throw – this is a non‑critical side effect
    }
  }

  async notifyCustomerForOrder(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
            },
          },
        },
      });

      if (!order || !order.user) {
        this.logger.warn(
          `Order ${orderId} or customer not found when notifying customer`,
        );
        return;
      }

      await this.sendCustomerOrderPlaced(
        order.user.id,
        order.id,
        order.orderNumber,
      );

      this.logger.log(
        `Customer notified for order ${order.orderNumber}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify customer for order ${orderId}`,
        error,
      );
      // Non-critical side effect
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

    await this.zohoEmailProvider.sendVendorOrderNotification(
      await this.getVendorEmail(vendorId),
      `${orderNumber}`
    );
  }

  async sendCustomerOrderPlaced(
    customerId: string,
    orderId: string,
    orderNumber: string,
  ) {

    this.logger.log(
      `Sending order confirmation email for order ${orderNumber} to customer ${customerId}`,
    );

    await this.zohoEmailProvider.sendOrderConfirmation(
      await this.getCustomerEmail(customerId),
      orderNumber,
    );
  }

  private async getCustomerEmail(customerId: string): Promise<string> {
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { email: true },
    });

    if (!customer?.email) {
      throw new NotFoundException(
        `Customer email not found for customerId: ${customerId}`,
      );
    }

    return customer.email;
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
        error,
      );
      // Non-critical – do not throw
    }
  }



  /**
   * Resolve admin recipients in priority order:
   *   1. ADMIN_ALERT_EMAILS env (comma-separated) — preferred in prod.
   *   2. Users with role ADMIN / SUPER_ADMIN in the DB.
   * De-dupe, filter blanks.
   */
  private async resolveAdminEmails(): Promise<string[]> {
    const envRaw = this.config.get<string>('ADMIN_ALERT_EMAILS', '');
    const envEmails = envRaw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    let dbEmails: string[] = [];
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] as any } },
        select: { email: true },
      });
      dbEmails = admins.map((a) => a.email).filter(Boolean);
    } catch (err) {
      this.logger.warn(
        `Failed to load DB admin emails: ${err instanceof Error ? err.message : err}`,
      );
    }

    return Array.from(new Set([...envEmails, ...dbEmails]));
  }

  /**
   * Fired when the dispatch retries are exhausted and the order
   * flips to UNACCEPTED. Management rule: notify admin, NOT the customer.
   */
  async sendUnacceptedAlert(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { store: true } },
          user: { select: { firstName: true, lastName: true, phoneNumber: true } },
        },
      });
      if (!order) {
        this.logger.warn(`sendUnacceptedAlert: order ${orderId} not found`);
        return;
      }

      const recipients = await this.resolveAdminEmails();
      if (!recipients.length) {
        this.logger.error(
          `No admin emails configured for UNACCEPTED alert on ${orderId}. ` +
          `Set ADMIN_ALERT_EMAILS or create an ADMIN user.`,
        );
        return;
      }

      const store = order.items[0]?.store;
      const customerName = [order.user?.firstName, order.user?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Customer';
      const itemCount = order.items.reduce(
        (sum, it) => sum + (it.quantity ?? 1),
        0,
      );
      const pickup = order.pickupLocation as any;
      const dropoff = order.dropoffLocation as any;

      const adminPortalUrl =
        this.config.get<string>('ADMIN_PORTAL_URL', 'https://admin.example.com') +
        `/dashboard`;

      const subject = `[Action Required] No driver found for order #${order.orderNumber}`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
          <h2 style="color:#b91c1c">Order needs manual dispatch</h2>
          <p>
            Order <strong>#${order.orderNumber}</strong> could not be assigned
            to a driver after all automatic retries were exhausted.
            Please manually assign a <strong>PARTNER</strong> driver from the
            admin portal.
          </p>

          <h3>Order summary</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td><b>Order #</b></td><td>${order.orderNumber}</td></tr>
            <tr><td><b>Total</b></td><td>₦${Number(order.totalAmount).toLocaleString()}</td></tr>
            <tr><td><b>Delivery fee</b></td><td>₦${Number(order.deliveryFee).toLocaleString()}</td></tr>
            <tr><td><b>Items</b></td><td>${itemCount}</td></tr>
            <tr><td><b>Store</b></td><td>${store?.storeName ?? 'N/A'}</td></tr>
            <tr><td><b>Customer</b></td><td>${customerName} (${order.user?.phoneNumber ?? 'n/a'})</td></tr>
            <tr><td><b>Pickup</b></td><td>${pickup?.lat ?? '?'}, ${pickup?.lng ?? '?'}</td></tr>
            <tr><td><b>Dropoff</b></td><td>${dropoff?.lat ?? '?'}, ${dropoff?.lng ?? '?'}</td></tr>
            <tr><td><b>Created at</b></td><td>${order.createdAt.toISOString()}</td></tr>
            <tr><td><b>Unaccepted at</b></td><td>${order.unacceptedAt?.toISOString() ?? 'just now'}</td></tr>
          </table>

          <p style="margin-top:24px">
            <a href="${adminPortalUrl}"
               style="background:#1d4ed8;color:#fff;padding:10px 18px;
                      border-radius:6px;text-decoration:none;display:inline-block">
              Open in admin portal →
            </a>
          </p>

          <p style="color:#6b7280;font-size:12px">
            This is an automated alert from the dispatch system.
            Customers are intentionally not notified at this stage.
          </p>
        </div>
      `;

      for (const email of recipients) {
        try {
          //await this.zohoEmailProvider.sendEmail(email, subject, html);
          await this.zohoEmailProvider.sendEmail(
            email,
            subject,
            `Order ${order.orderNumber} needs manual driver assignment.`,
            html,
          );
          this.logger.log(
            `UNACCEPTED alert for ${order.orderNumber} sent to ${email}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to email ${email} about ${order.orderNumber}: ` +
            `${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `sendUnacceptedAlert(${orderId}) failed: ` +
        `${err instanceof Error ? err.stack : err}`,
      );
      // Never throw — this is a side-effect, order state is already persisted.
    }
  }

}
