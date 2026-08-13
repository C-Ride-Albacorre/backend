import { Module } from '@nestjs/common';
import { CallService } from './call.service';
import { CallController } from './call.controller';
import { NotificationModule } from '../notification/notification.module';
import { PushNotificationService } from '../notification/push-notification.service';
import { AgoraTokenService } from './provider/agora-token.service';

@Module({
  imports: [NotificationModule],
  controllers: [CallController],
  providers: [
    CallService,
    PushNotificationService,
    AgoraTokenService,
  ],
})
export class CallModule {}