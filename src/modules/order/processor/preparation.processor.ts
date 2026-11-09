// src/modules/preparation/preparation.processor.ts

import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { OrderStatus } from '@prisma/client';

import { PrismaService } from '../../../shared/services/prisma.service';
import { OrderService } from '../../order/order.service';
import { QUEUES } from '../../../shared/constants';
import { NotificationService } from '../../notification/notification.service';

@Processor(QUEUES.PREPARATION)
export class PreparationProcessor extends WorkerHost {
  private readonly logger = new Logger(PreparationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly orderService: OrderService,
    @InjectQueue(QUEUES.PREPARATION)
    private readonly prepQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name !== 'prep-escalation') return;

    const { orderId, attempt } = job.data;
    this.logger.log(
      `prep-escalation check for ${orderId}, attempt ${attempt}`,
    );

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderStatus: true,
        preparationReadyAt: true,
        userId: true,
        orderNumber: true,
        items: { include: { store: { include: { user: true } } } },
      },
    });

    if (!order) return;

    // If vendor already clicked Ready (or order left PROCESSING), stop.
    if (
      order.orderStatus !== OrderStatus.ORDER_PROCESSING ||
      order.preparationReadyAt
    ) {
      this.logger.log(
        `prep-escalation ${orderId}: resolved (status=${order.orderStatus}, ready=${!!order.preparationReadyAt})`,
      );
      return;
    }

    // ── 1. Nudge vendor ──
    const store = order.items[0]?.store;
    if (store) {
      await this.notification.sendVendorPrepOverdue(
        orderId,
        attempt,
      );
    }

    // ── 2. Soft customer message on attempt 1 ──
    // if (attempt === 1) {
    //   await this.notification.sendCustomerPrepDelayed(
    //     order.userId,
    //     order.orderNumber,
    //   );
    // }

    // ── 3. Admin escalation on attempt 3 ──
    // if (attempt === 3) {
    //   await this.notification.sendAdminPrepOverdue(orderId);
    // }

    // ── 4. Extend timeout and re-enqueue ──
    const nextCheckAt = new Date(Date.now() + 5 * 60_000);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { preparationTimeoutAt: nextCheckAt },
    });

    if (attempt < 20) {
      await this.prepQueue.add(
        'prep-escalation',
        { orderId, attempt: attempt + 1 },
        {
          delay: 5 * 60_000,
          jobId: `prep-escalation-${orderId}-${attempt + 1}`,
          removeOnComplete: true,
        },
      );
    }

    this.logger.warn(
      `prep-escalation ${orderId} attempt=${attempt} sent; next check in 5m`,
    );
  }
}