import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../../shared/services/prisma.service';
import { QUEUES } from '../../../../shared/constants';
import { PushNotificationService } from '../../push-notification.service';
import { ZohoEmailProvider } from '../../../verification/providers/zoho-email.provider';
import { NotificationType } from '@prisma/client';

@Processor(QUEUES.CUSTOMER_NOTIFICATION)
export class CustomerNotificationProcessor extends WorkerHost {
    private readonly logger = new Logger(CustomerNotificationProcessor.name);

    constructor(
        private pushService: PushNotificationService,
        private prisma: PrismaService,
        private zohoEmailProvider: ZohoEmailProvider
    ) {
        super();
    }

    async process(job: Job): Promise<any> {
        switch (job.name) {
            case 'order-confirmed': {
                const { orderId } = job.data;
                this.logger.log(`Sending order-confirmed push to customer for order ${orderId}`);

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found; skipping customer push`);
                    return;
                }

                try {
                    await this.pushService.sendToCustomer(order.userId, {
                        title: 'Order Confirmed 🎉',
                        body: `Your order ${order.orderNumber} has been confirmed and is being prepared.`,
                        data: {
                            orderId: String(order.id),
                            orderNumber: order.orderNumber,
                            type: 'ORDER_CONFIRMED',
                        },
                        priority: 'high',
                        sound: 'default',
                    });
                    this.logger.log(`📲 Order-confirmed push sent to customer ${order.userId} for order ${orderId}`);
                } catch (e) {
                    this.logger.error(
                        `sendToUser threw for customer ${order.userId} order ${orderId}: ${e instanceof Error ? e.message : e}`,
                    );
                    throw e; // let BullMQ retry (configure attempts on the queue)
                }
                break;
            };
            case 'order-preparing': {
                const { orderId, prepMins, storeName } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title = 'Your Order Is Being Prepared 👨‍🍳';
                const body = `Your order #${order.orderNumber} has been accepted by ${storeName} and is being prepared. Estimated preparation time: ${prepMins} minutes.`;

                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            prepMins,
                            storeName,
                            type: 'ORDER_PREPARING',
                        },
                    },
                });

                await this.pushService.sendToCustomer(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        prepMins: String(prepMins),
                        type: 'ORDER_PREPARING',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                if (false && order.user?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        order.user.email,
                        `Order #${order.orderNumber} is being prepared`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(`Order-preparing notification sent to ${order.userId}`);

                break;
            };
            case 'order-cancelled': {
                const { orderId, reason } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title = 'Order Cancelled ❌';
                const body = `Unfortunately, your order #${order.orderNumber} has been cancelled by the store.${reason ? ` Reason: ${reason}` : ''}`;

                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            reason: reason ?? null,
                            type: 'ORDER_CANCELLED',
                        },
                    },
                });

                await this.pushService.sendToCustomer(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        reason: reason ?? '',
                        type: 'ORDER_CANCELLED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                if (order.user?.email) {
                    await this.zohoEmailProvider.sendCustomerOrderCancelledNotification(
                        order.user.email,
                        `${order.orderNumber}`,
                        reason,
                    );
                }

                this.logger.log(`Order-cancelled notification sent to ${order.userId}`);

                break;
            };
            case 'order-ready': {
                const { orderId } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title = 'Your Order Is Ready 🎉';
                const body = `Your order #${order.orderNumber} is ready. We're finding a driver for you now.`;

                // In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            type: 'ORDER_READY',
                        },
                    },
                });

                // Push notification
                await this.pushService.sendToCustomer(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        type: 'ORDER_READY',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // Email notification
                if (false && order.user?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        order.user.email,
                        `Order #${order.orderNumber} is ready`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Order-ready notifications sent to customer ${order.userId}`,
                );

                break;
            };
            case 'driver-assigned': {
                const { orderId, driverId } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title = 'Driver Assigned 🚗';
                const body = `A driver has been assigned to your order #${order.orderNumber}. Your order is on its way to being delivered.`;

                // In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            type: 'DRIVER_ASSIGNED',
                        },
                    },
                });

                // Push notification
                await this.pushService.sendToCustomer(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        type: 'DRIVER_ASSIGNED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // Email notification
                if (false && order.user?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        order.user.email,
                        `Driver assigned to order #${order.orderNumber}`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Driver-assigned notifications sent to customer ${order.userId}`,
                );

                break;
            };
            case 'order-picked-up': {
                const { orderId, driverId } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title = 'Your Order Is on the Way! 🚗';
                const body = `Your order #${order.orderNumber} has been picked up by the driver and is now on its way to you.`;

                // 1. In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            type: 'ORDER_PICKED_UP',
                        },
                    },
                });

                // 2. Push notification
                await this.pushService.sendToUser(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        type: 'ORDER_PICKED_UP',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // 3. Email notification
                if (false && order.user?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        order.user.email,
                        `Your order #${order.orderNumber} has been picked up`,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Order-picked-up notifications sent to customer ${order.userId}`,
                );

                break;
            };
            case 'driver-arrived': {
                const { orderId, driverId, leg } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title =
                    leg === 'to-vendor'
                        ? 'Driver Arrived at the Store 🚗'
                        : 'Driver Arrived at Your Location 🚗';

                const body =
                    leg === 'to-vendor'
                        ? `Your driver has arrived at the store for order #${order.orderNumber} and is picking up your order.`
                        : `Your order #${order.orderNumber} has arrived! Please collect your delivery.`;

                // 1. In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            leg,
                            type: 'DRIVER_ARRIVED',
                        },
                    },
                });

                // 2. Push notification
                await this.pushService.sendToUser(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        leg,
                        type: 'DRIVER_ARRIVED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // 3. Email notification
                if (false && order.user?.email) {
                    await this.zohoEmailProvider.sendEmail(
                        order.user.email,
                        title,
                        `<p>${body}</p>`,
                    );
                }

                this.logger.log(
                    `Driver-arrived notification sent to customer ${order.userId} for order ${orderId}, leg: ${leg}`,
                );

                break;
            };
            case 'order-delivered': {
                const { orderId, driverId } = job.data;

                const order = await this.prisma.order.findUnique({
                    where: { id: orderId },
                    select: {
                        id: true,
                        orderNumber: true,
                        userId: true,
                        user: {
                            select: { email: true },
                        },
                    },
                });

                if (!order) {
                    this.logger.warn(`Order ${orderId} not found`);
                    return;
                }

                const title = 'Order Delivered Successfully! 🎉';
                const body = `Your order #${order.orderNumber} has been successfully delivered. Thank you for ordering with us!`;

                // 1. In-app notification
                await this.prisma.notification.create({
                    data: {
                        userId: order.userId,
                        type: NotificationType.ORDER_STATUS,
                        title,
                        body,
                        data: {
                            orderId,
                            orderNumber: order.orderNumber,
                            driverId,
                            type: 'ORDER_DELIVERED',
                        },
                    },
                });

                // 2. Push notification
                await this.pushService.sendToUser(order.userId, {
                    title,
                    body,
                    data: {
                        orderId: String(orderId),
                        orderNumber: order.orderNumber,
                        driverId: String(driverId),
                        type: 'ORDER_DELIVERED',
                    },
                    priority: 'high',
                    sound: 'default',
                });

                // 3. Email notification
                if (order.user?.email) {
                    await this.zohoEmailProvider.sendCustomerOrderDeliveredNotification(
                        order.user.email,
                        `${order.orderNumber}`,
                    );
                }

                this.logger.log(
                    `Order-delivered notifications sent to customer ${order.userId}`,
                );

                break;
            }

            // Add more customer event names here as you grow
            default:
                this.logger.warn(`Unknown customer-notification job: ${job.name}`);
        }
    }
}