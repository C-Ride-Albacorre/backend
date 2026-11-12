import { forwardRef, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { VendorNotificationGateway } from '../../common/map-gateway/vendor-notification.gateway';
import { MapGateway } from '../../common/map-gateway/map.gateway';
import { PushNotificationService } from './push-notification.service';
import { DriverModule } from '../driver/driver.module';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '../../shared/constants';

@Module({
  imports: [
    forwardRef(() => DriverModule),
    BullModule.registerQueue(
      { name: QUEUES.CUSTOMER_NOTIFICATION },
      { name: QUEUES.VENDOR_NOTIFICATION },
   ),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    ZohoEmailProvider,
    VendorNotificationGateway,
    MapGateway,
    PushNotificationService,
  ],
  exports: [
    NotificationService,
    VendorNotificationGateway,
    MapGateway,
    PushNotificationService,
  ],
})
export class NotificationModule { }
