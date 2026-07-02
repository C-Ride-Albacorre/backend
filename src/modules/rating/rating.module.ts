import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { RatingService } from './rating.service';
import { RatingReminderProcessor } from './rating-reminder.processor';

import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from 'src/shared/services/prisma.service';

@Module({
  imports: [
    NotificationModule,
    BullModule.registerQueue({
      name: 'rating-reminders',
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [RatingService, RatingReminderProcessor, PrismaService],
  exports: [RatingService],
})
export class RatingModule {}