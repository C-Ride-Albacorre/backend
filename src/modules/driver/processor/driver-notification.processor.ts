// driver-notification.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PushNotificationService } from '../../../modules/notification/push-notification.service';

@Processor('driver-notification')
export class DriverNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(DriverNotificationProcessor.name);

  constructor(private pushService: PushNotificationService) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { driverId, orderId, vendorLocation } = job.data;
    this.logger.log(`Sending push to driver ${driverId} for order ${orderId}`);

    await this.pushService.sendToDriver(driverId, {
      title: 'New Delivery Request',
      body: 'Tap to view order details and accept',
      data: {
        orderId,
        vendorLat: vendorLocation.lat.toString(),
        vendorLng: vendorLocation.lng.toString(),
        vendorLocation: JSON.stringify(vendorLocation),
        type: 'delivery_request',
      },
      priority: 'high',
      sound: 'notification.wav',
    });
  }
}
