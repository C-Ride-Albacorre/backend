import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { RatingService } from './rating.service';
import { RatingReminderProcessor } from './rating-reminder.processor';

import { NotificationModule } from '../notification/notification.module';
import { RatingController } from './rating.controller';

@Module({
  imports: [
    NotificationModule,
    BullModule.registerQueue({
      name: 'rating-reminders',
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [RatingController],
  providers: [RatingService, RatingReminderProcessor],
  exports: [RatingService],
})
export class RatingModule {}