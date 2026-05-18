import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PushNotificationService } from 'src/modules/notification/push-notification.service';

@Processor('driver-notification')
export class DriverNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(DriverNotificationProcessor.name);

  constructor(private pushService: PushNotificationService) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { driverId, orderId, vendorLocation } = job.data;
    this.logger.log(`Notifying driver ${driverId} for order ${orderId}`);
    // Send push via FCM/APNS
    await this.pushService.sendToDriver(driverId, {
      title: 'New delivery request',
      body: 'Tap to accept or decline',
      data: { orderId, vendorLocation },
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
