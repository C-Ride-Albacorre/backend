import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { VendorNotificationGateway } from 'src/map-gateway/vendor-notification.gateway';
import { MapGateway } from 'src/map-gateway/map.gateway';
import { PushNotificationService } from './push-notification.service';

@Module({
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
export class NotificationModule {}
