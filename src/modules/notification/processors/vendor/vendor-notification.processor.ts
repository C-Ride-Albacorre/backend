import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../../shared/services/prisma.service';
import { QUEUES } from '../../../../shared/constants';
import { PushNotificationService } from '../../push-notification.service';
import { ZohoEmailProvider } from '../../../verification/providers/zoho-email.provider';
import { NotificationType } from '@prisma/client';

@Processor(QUEUES.VENDOR_NOTIFICATION)
export class VendorNotificationProcessor extends WorkerHost {
    private readonly logger = new Logger(VendorNotificationProcessor.name);

    constructor(
        private pushService: PushNotificationService,
        private prisma: PrismaService,
        private zohoEmailProvider: ZohoEmailProvider
    ) {
        super();
    }

    async process(job: Job): Promise<any> {
        switch (job.name) {
            case 'new-order': {
                const { orderId, storeId } = job.data;
                this.logger.log(`Sending new-order push to vendor ${storeId} for order ${orderId}`);

                // Resolve the store owner / vendor user id(s)
                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true, // adjust to your schema: userId / userId / vendorId
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found; skipping vendor push`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: { orderNumber: true },
                });

                try {
                    await this.pushService.sendToVendor(store.userId, {
                        title: 'New Order Received 🛒',
                        body: `You have a new order${order ? ` (${order.orderNumber})` : ''} to prepare.`,
                        data: {
                            orderId: String(orderId),
                            storeId: String(storeId),
                            orderNumber: order?.orderNumber ?? '',
                            type: 'NEW_ORDER',
                        },
                        priority: 'high',
                        sound: 'default',
                    });
                    this.logger.log(`📲 New-order push sent to vendor ${store.userId} for order ${orderId}`);
                } catch (e) {
                    this.logger.error(
                        `sendToVendor threw for vendor ${store.userId} order ${orderId}: ${e instanceof Error ? e.message : e}`,
                    );
                    throw e;
                }
                break;
            };
            case 'order-accepted': {
                const { orderId, storeId, prepMins } = job.data;

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: { orderNumber: true },
                });

                if (!order) return;

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Order Accepted Successfully 🎉';
                const body = `You have successfully accepted order #${order.orderNumber}. Preparation time: ${prepMins} minutes.`;

                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            storeId,
                            prepMins,
                            type: 'ORDER_ACCEPTED',
                        },
                    },
                });

                await this.pushService.sendToVendor(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        storeId: String(storeId),
                        prepMins: String(prepMins),
                        type: 'ORDER_ACCEPTED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        `Order #${order.orderNumber} accepted`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(`Order-accepted notification sent to vendor ${store.userId}`);

                break;
            };

            case 'order-declined': {
                const { orderId, storeId, reason } = job.data;

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: { orderNumber: true },
                });

                if (!order) return;

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Order Declined';
                const body = `Order #${order.orderNumber} has been declined successfully.${reason ? ` Reason: ${reason}` : ''}`;

                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            storeId,
                            reason: reason ?? null,
                            type: 'ORDER_DECLINED',
                        },
                    },
                });

                await this.pushService.sendToVendor(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        storeId: String(storeId),
                        reason: reason ?? '',
                        type: 'ORDER_DECLINED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        `Order #${order.orderNumber} declined`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(`Order-declined notification sent to vendor ${store.userId}`);

                break;
            }
            case 'order-ready': {
                const { orderId, storeId } = job.data;

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        orderNumber: true,
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Order Ready Successfully 🎉';
                const body = `Order #${order.orderNumber} for ${store.storeName} has been marked ready. Driver dispatch has started.`;

                // In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            storeId,
                            type: 'ORDER_READY',
                        },
                    },
                });

                // Push notification
                await this.pushService.sendToVendor(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        storeId: String(storeId),
                        type: 'ORDER_READY',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // Email notification
                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        `Order #${order.orderNumber} marked ready`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Order-ready notifications sent to vendor ${store.userId}`,
                );

                break;
            };

            case 'driver-assigned': {
                const { orderId, storeId, driverId } = job.data;

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        orderNumber: true,
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Driver Assigned to Your Order 🚗';
                const body = `A driver has accepted order #${order.orderNumber} and is assigned to pick it up from ${store.storeName}.`;

                // In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            storeId,
                            driverId,
                            type: 'DRIVER_ASSIGNED',
                        },
                    },
                });

                // Push notification
                await this.pushService.sendToVendor(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        storeId: String(storeId),
                        driverId: String(driverId),
                        type: 'DRIVER_ASSIGNED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // Email notification
                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        `Driver assigned to order #${order.orderNumber}`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Driver-assigned notifications sent to vendor ${store.userId}`,
                );

                break;
            };
            case 'order-picked-up': {
                const { orderId, driverId, storeId } = job.data;

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        orderNumber: true,
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Order Picked Up by Driver 📦';
                const body = `The driver has successfully picked up order #${order.orderNumber} from ${store.storeName}. The order is now on its way to the customer.`;

                // 1. In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            storeId,
                            type: 'ORDER_PICKED_UP',
                        },
                    },
                });

                // 2. Push notification
                await this.pushService.sendToUser(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        storeId: String(storeId),
                        type: 'ORDER_PICKED_UP',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // 3. Email notification
                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        `Order #${order.orderNumber} picked up by driver`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Order-picked-up notifications sent to vendor ${store.userId} for order ${orderId}`,
                );

                break;
            };
            case 'driver-arrived': {
                const { orderId, driverId, storeId, leg } = job.data;

                // Vendor notification is only relevant for store arrival
                if (leg !== 'to-vendor') {
                    break;
                }

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        orderNumber: true,
                    },
                });

                if (!order) return;

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Driver Arrived at Your Store 🚗';
                const body = `The driver has arrived at ${store.storeName} to pick up order #${order.orderNumber}. Please hand over the order.`;

                // 1. In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            storeId,
                            type: 'DRIVER_ARRIVED',
                        },
                    },
                });

                // 2. Push notification
                await this.pushService.sendToUser(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        storeId: String(storeId),
                        type: 'DRIVER_ARRIVED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // 3. Email notification
                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        title,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Driver-arrived notification sent to vendor ${store.userId} for order ${orderId}`,
                );

                break;
            };
            case 'order-delivered': {
                const { orderId, driverId, storeId } = job.data;

                const store = await this.prisma.store.findUnique({
                    where: { id: storeId },
                    select: {
                        id: true,
                        storeName: true,
                        userId: true,
                    },
                });

                if (!store) {
                    this.logger.warn(`Store ${storeId} not found`);
                    return;
                }

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        orderNumber: true,
                    },
                });

                if (!order) return;

                const vendor = await this.prisma.user.findUnique({
                    where: { id: store.userId },
                    select: { email: true },
                });

                const title = 'Order Delivered Successfully 🎉';
                const body = `Order #${order.orderNumber} from ${store.storeName} has been successfully delivered to the customer.`;

                // 1. In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: store.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            storeId,
                            type: 'ORDER_DELIVERED',
                        },
                    },
                });

                // 2. Push notification
                await this.pushService.sendToUser(store.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        storeId: String(storeId),
                        type: 'ORDER_DELIVERED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // 3. Email notification
                if (vendor?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        vendor.email,
                        `Order #${order.orderNumber} delivered successfully`,
                        `
        <h2>Order Delivered Successfully!</h2>
        <p>${body}</p>
        <p>Thank you for fulfilling this order.</p>
      `,
                    );
                }

                this.logger.log(
                    `Order-delivered notifications sent to vendor ${store.userId}`,
                );

                break;
            }

            default:
                this.logger.warn(`Unknown vendor-notification job: ${job.name}`);
        }
    }
}