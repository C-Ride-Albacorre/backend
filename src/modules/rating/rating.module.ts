import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { RatingService } from './rating.service';
import { RatingReminderProcessor } from './rating-reminder.processor';

import { NotificationModule } from '../notification/notification.module';
import { RatingController } from './rating.controller';
import { QUEUES } from '../../shared/constants';

@Module({
  imports: [
    NotificationModule,
    BullModule.registerQueue({
      //name: 'rating-reminders',
      name: QUEUES.RATING_REMINDERS,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [RatingController],
  providers: [RatingService, RatingReminderProcessor],
  exports: [RatingService],
})
export class RatingModule {}