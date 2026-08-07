// processors/order.processor.ts
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PushNotificationService } from 'src/modules/notification/push-notification.service';
import { PrismaService } from 'src/shared/services/prisma.service';

@Processor('orderQueue')
export class OrderProcessor {
    constructor(
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
        private readonly pushService: PushNotificationService,
        private readonly logger: Logger,
    ) { }

    @Process('PICKUP')
    async handlePickup(job: Job<{ orderId: string; context: any }>) {
        const { orderId } = job.data;

        // 1. Fetch order with user and driver details
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                user: { select: { email: true, id: true } },
                driverAssignment: { include: { driver: { select: { user: { select: { name: true } } } } } },
            },
        });

        if (!order) {
            this.logger.error(`Order ${orderId} not found for PICKUP job`);
            return; // or throw if you want retry
        }

        // 2. Idempotency: check if already notified
        if (order.pickupNotifiedAt) {
            this.logger.log(`Pickup notification already sent for order ${orderId}`);
            return;
        }

        const driverName = order.driverAssignment?.driver?.user?.name || 'Driver';

        // 3. Send notifications (fire-and-forget, but catch errors)
        const notificationPromises = [];

        // Email
        if (order.user?.email) {
            notificationPromises.push(
                this.emailService.sendPickupConfirmation(order.user.email, orderId, driverName)
                    .catch(err => this.logger.error(`Email failed for order ${orderId}`, err))
            );
        }

        // Push
        if (order.user?.id) {
            notificationPromises.push(
                this.pushService.sendPickupPush(order.user.id, orderId, driverName)
                    .catch(err => this.logger.error(`Push failed for order ${orderId}`, err))
            );
        }

        // 4. Wait for all notifications to complete (or not, depending on your preference)
        await Promise.allSettled(notificationPromises);

        // 5. Mark as notified to avoid duplicates (optional)
        await this.prisma.order.update({
            where: { id: orderId },
            data: { pickupNotifiedAt: new Date() },
        });
    }
}