import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaService } from '../../shared/services/prisma.service';
import { PushNotificationService } from '../notification/push-notification.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
  ],
  providers: [
    ChatGateway,
    ChatService,
    PrismaService,
    PushNotificationService,
    WsJwtGuard,
  ],
  controllers: [ChatController],
})
export class ChatModule { }